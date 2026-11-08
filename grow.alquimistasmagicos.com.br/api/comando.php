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

    if (isset($_POST['fase'])) $cmd['fase'] = (int)$_POST['fase'];
    if (isset($_POST['luz'])) {
        $cmd['luz'] = (int)$_POST['luz']; // 0: AUTO, 1: ON, 2: OFF
        file_put_contents(__DIR__ . '/modo_luz.txt', (string)$cmd['luz']);
    }
    if (isset($_POST['reset_agua'])) $cmd['reset_agua'] = 1;
    if (isset($_POST['ota'])) $cmd['ota'] = 1;

    // Salva configurações climáticas no Banco de Dados MySQL
    if (isset($_POST['config'])) {
        $jsonStr = $_POST['config'];
        $decoded = json_decode($jsonStr, true);
        if ($decoded) {
            $conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
            if (!$conn->connect_error) {
                $conn->query("CREATE TABLE IF NOT EXISTS config_sistema (
                    chave VARCHAR(50) PRIMARY KEY,
                    valor LONGTEXT,
                    atualizado_em INT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

                $now = time();
                $stmt = $conn->prepare("REPLACE INTO config_sistema (chave, valor, atualizado_em) VALUES ('clima', ?, ?)");
                $stmt->bind_param("si", $jsonStr, $now);
                $stmt->execute();
                $stmt->close();
                $conn->close();
            }
        }
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
