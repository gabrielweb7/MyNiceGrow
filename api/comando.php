<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');

// CORS Preflight: responde OK imediatamente
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$localConfig = __DIR__ . '/../config.local.php';
$mainConfig  = __DIR__ . '/../config.php';

if (file_exists($localConfig)) {
    require_once $localConfig;
} elseif (file_exists($mainConfig)) {
    require_once $mainConfig;
}

$arquivo_comando = __DIR__ . '/comando_pendente.json';

// SEGURANÇA: Exige a chave secreta para aceitar comandos
// Nota: Usa $_SERVER porque apache_request_headers() crasha no FastCGI da HostGator
$apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
$adminKeyEsperada = defined('ADMIN_KEY') ? ADMIN_KEY : '';
if (empty($adminKeyEsperada) || $apiKey !== $adminKeyEsperada) {
    usleep(500000); // Atraso de 0.5s anti-força bruta
    http_response_code(401);
    echo json_encode(["error" => "Acesso negado. Chave invalida."]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // BUG CORRIGIDO: Race Condition — abre o arquivo com lock exclusivo antes de ler e gravar
    // Evita perda de comandos quando usuário clica em dois botões quase ao mesmo tempo
    $fp = fopen($arquivo_comando, 'c+');
    if ($fp === false) {
        http_response_code(500);
        echo json_encode(["error" => "Falha ao abrir arquivo de comandos."]);
        exit;
    }
    flock($fp, LOCK_EX);

    $conteudo = '';
    fseek($fp, 0);
    while (!feof($fp)) {
        $conteudo .= fread($fp, 8192);
    }
    $cmd = json_decode($conteudo, true) ?: [];

    if (isset($_POST['fase'])) {
        $f = (int)$_POST['fase'];
        if (in_array($f, [0, 1, 2, 4], true)) {
            $cmd['fase'] = $f;
        }
    }
    if (isset($_POST['luz'])) {
        $l = (int)$_POST['luz']; // 0: AUTO, 1: ON, 2: OFF
        if (in_array($l, [0, 1, 2], true)) {
            $cmd['luz'] = $l;
            file_put_contents(__DIR__ . '/modo_luz.txt', (string)$l);
        }
    }
    if (isset($_POST['ar'])) {
        $a = (int)$_POST['ar']; // 0: AUTO, 1: ON, 2: OFF
        if (in_array($a, [0, 1, 2], true)) {
            $cmd['ar'] = $a;
            file_put_contents(__DIR__ . '/modo_ar.txt', (string)$a);
        }
    }
    if (isset($_POST['vento_ext'])) {
        $ve = (int)$_POST['vento_ext']; // 0: AUTO, 1: ON, 2: OFF
        if (in_array($ve, [0, 1, 2], true)) {
            $cmd['vento_ext'] = $ve;
            file_put_contents(__DIR__ . '/modo_vento_ext.txt', (string)$ve);
        }
    }
    if (isset($_POST['reset_agua'])) $cmd['reset_agua'] = 1;
    if (isset($_POST['ota'])) $cmd['ota'] = 1;
    if (isset($_POST['rollback'])) $cmd['rollback'] = 1;
    if (isset($_POST['url_ota'])) $cmd['url_ota'] = trim($_POST['url_ota']);

    // Salva configurações climáticas no Banco de Dados MySQL (com validação e clamp seguro)
    if (isset($_POST['config'])) {
        if (!defined('DB_HOST')) {
            flock($fp, LOCK_UN);
            fclose($fp);
            http_response_code(500);
            echo json_encode(["error" => "Configuracao do banco de dados ausente."]);
            exit;
        }
        $jsonStr = $_POST['config'];
        $decoded = is_string($jsonStr) ? json_decode($jsonStr, true) : null;
        if (!is_array($decoded) || (!isset($decoded['1']) && !isset($decoded['2']))) {
            flock($fp, LOCK_UN);
            fclose($fp);
            http_response_code(400);
            echo json_encode(["error" => "JSON de configuracao climatica invalido."]);
            exit;
        }

        $defaults = [
            "1" => ["tX" => 28.0, "uA" => 95.0, "fO" => 1, "fF" => 40, "vO" => 1, "vF" => 2, "vU" => 1],
            "2" => ["tX" => 29.0, "uA" => 92.0, "fO" => 2, "fF" => 25, "vO" => 1, "vF" => 2, "vU" => 1]
        ];
        $clampNum = function($val, $min, $max, $def) {
            if (!is_numeric($val)) return $def;
            $v = (float)$val;
            return max($min, min($max, $v));
        };
        $sanitized = [];
        foreach (["1", "2"] as $k) {
            $src = isset($decoded[$k]) && is_array($decoded[$k]) ? $decoded[$k] : [];
            $d = $defaults[$k];
            $uRaw = isset($src['uA']) ? $src['uA'] : (isset($src['uN']) ? $src['uN'] : $d['uA']);
            $uA = round($clampNum($uRaw, 40.0, 99.0, $d['uA']), 1);
            $sanitized[$k] = [
                "tX" => round($clampNum($src['tX'] ?? null, 15.0, 35.0, $d['tX']), 1),
                "uA" => $uA,
                "uN" => $uA,
                "uX" => $uA,
                "fO" => (int)round($clampNum($src['fO'] ?? null, 0, 1440, $d['fO'])),
                "fF" => (int)round($clampNum($src['fF'] ?? null, 0, 1440, $d['fF'])),
                "vO" => (int)round($clampNum($src['vO'] ?? null, 0, 1440, $d['vO'])),
                "vF" => (int)round($clampNum($src['vF'] ?? null, 0, 1440, $d['vF'])),
                "vU" => (!isset($src['vU']) || (int)$src['vU'] === 1) ? 1 : 0
            ];
        }

        // Sanitiza parâmetros de HVAC e Travas de Segurança Térmica
        $srcHvac = isset($decoded['hvac']) && is_array($decoded['hvac']) ? $decoded['hvac'] : [];
        $sanitized['hvac'] = [
            "tCongela" => round($clampNum($srcHvac['tCongela'] ?? null, 5.0, 25.0, 15.0), 1),
            "tPosMeta" => (int)round($clampNum($srcHvac['tPosMeta'] ?? null, 1, 60, 5)),
            "tMaxRun" => (int)round($clampNum($srcHvac['tMaxRun'] ?? null, 10, 180, 45)),
            "tCorteLuz" => round($clampNum($srcHvac['tCorteLuz'] ?? null, 25.0, 45.0, 34.0), 1)
        ];

        $jsonSanitizado = json_encode($sanitized);

        $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
        if ($conn->connect_error) {
            flock($fp, LOCK_UN);
            fclose($fp);
            http_response_code(500);
            echo json_encode(["error" => "Falha ao conectar no banco de dados."]);
            exit;
        }
        $conn->set_charset('utf8mb4');
        $conn->query("CREATE TABLE IF NOT EXISTS config_sistema (
            chave VARCHAR(50) PRIMARY KEY,
            valor LONGTEXT,
            atualizado_em INT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $now = time();
        $stmt = $conn->prepare("REPLACE INTO config_sistema (chave, valor, atualizado_em) VALUES ('clima', ?, ?)");
        $stmt->bind_param("si", $jsonSanitizado, $now);
        $stmt->execute();
        $stmt->close();
        $conn->close();
    }

    // Grava o JSON atualizado com lock ainda ativo (atômico)
    ftruncate($fp, 0);
    fseek($fp, 0);
    fwrite($fp, json_encode($cmd));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);

    echo json_encode(["status" => "Comando salvo na fila e no Banco de Dados!", "cmd" => $cmd]);
}
