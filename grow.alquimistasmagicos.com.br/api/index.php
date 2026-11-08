<?php
date_default_timezone_set('America/Sao_Paulo');
ob_start("ob_gzhandler"); // Compressão GZIP ativa: reduz o payload do painel em 90%!
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Expose-Headers: X-Fw-Placa, X-Fw-Nuvem');
$localConfig = __DIR__ . '/../config.local.php';
$mainConfig  = __DIR__ . '/../config.php';

// Auto-cria config.local.php no servidor na primeira execução para manter as credenciais fora do Git
if (!file_exists($localConfig)) {
    if (file_exists($mainConfig)) {
        $conteudo = @file_get_contents($mainConfig);
        if ($conteudo && strpos($conteudo, 'poder692_grow_ia') !== false) {
            @file_put_contents($localConfig, $conteudo);
        }
    }
}

if (file_exists($localConfig)) {
    require_once $localConfig;
} elseif (file_exists($mainConfig)) {
    require_once $mainConfig;
}

// Robustez: se nenhum arquivo de configuração foi carregado, responde JSON em vez de Fatal Error
if (!defined('DB_HOST') || !defined('API_KEY')) {
    http_response_code(500);
    die(json_encode(["error" => "Configuracao do servidor ausente"]));
}

// Retenção do histórico de telemetria (mesmo valor usado pelas duas rotinas de auto-limpeza)
define('DIAS_RETENCAO_TELEMETRIA', 30);

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(["error" => "Falha na conexão com banco de dados"]));
}
$conn->set_charset('utf8mb4');

// Retorna o caminho do binário de firmware SOMENTE da família da placa ativa.
// BUG CORRIGIDO: antes havia fallback cruzado (C3 <-> S3); se o .bin da própria placa faltasse,
// o servidor anunciava a data do .bin da OUTRA placa e o ESP tentava OTA da sua URL inexistente a cada 10s.
function caminhoBinFirmware($boardModel) {
    $pasta = (stripos($boardModel, 'C3') !== false) ? 'esp32.esp32.esp32c3' : 'esp32.esp32.esp32s3';
    $candidatos = [
        __DIR__ . '/../../build/' . $pasta . '/esp32c3.ino.bin',
        __DIR__ . '/../build/' . $pasta . '/esp32c3.ino.bin'
    ];
    foreach ($candidatos as $c) {
        if (file_exists($c)) return $c;
    }
    return null;
}

// Garante que as colunas rele_ar e rele_vento_ext existem na tabela telemetria
function garantirColunasExtras($conn) {
    static $verificado = false;
    if ($verificado) return;
    $check1 = $conn->query("SHOW COLUMNS FROM telemetria LIKE 'rele_ar'");
    if ($check1 && $check1->num_rows === 0) {
        $conn->query("ALTER TABLE telemetria ADD COLUMN rele_ar TINYINT(1) DEFAULT 0 AFTER rele_exaust");
    }
    $check2 = $conn->query("SHOW COLUMNS FROM telemetria LIKE 'rele_vento_ext'");
    if ($check2 && $check2->num_rows === 0) {
        $conn->query("ALTER TABLE telemetria ADD COLUMN rele_vento_ext TINYINT(1) DEFAULT 0 AFTER rele_ar");
    }
    $verificado = true;
}

// Garante que a tabela de configurações do sistema existe no MySQL
function garantirTabelaConfig($conn) {
    $conn->query("CREATE TABLE IF NOT EXISTS config_sistema (
        chave VARCHAR(50) PRIMARY KEY,
        valor LONGTEXT,
        atualizado_em INT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    
    // Se não existir clima inicial gravado, insere o padrão de fábrica
    $check = $conn->query("SELECT valor FROM config_sistema WHERE chave = 'clima'");
    if ($check && $check->num_rows === 0) {
        $padrao = json_encode([
            "1" => ["tX" => 28.0, "uA" => 95.0, "uN" => 95.0, "uX" => 95.0, "fO" => 1, "fF" => 40, "vO" => 1, "vF" => 2, "vU" => 1],
            "2" => ["tX" => 29.0, "uA" => 92.0, "uN" => 92.0, "uX" => 92.0, "fO" => 2, "fF" => 25, "vO" => 1, "vF" => 2, "vU" => 1]
        ]);
        $t = time();
        $conn->query("INSERT INTO config_sistema (chave, valor, atualizado_em) VALUES ('clima', '$padrao', $t)");
    }
}

$method = $_SERVER['REQUEST_METHOD'];

// =======================================================
// RETORNAR CONFIGURAÇÕES PARA O DASHBOARD (Direto do MySQL)
// =======================================================
if ($method === 'GET' && isset($_GET['get_config'])) {
    garantirTabelaConfig($conn);
    header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
    $res = $conn->query("SELECT valor, atualizado_em FROM config_sistema WHERE chave = 'clima'");
    if ($res && $row = $res->fetch_assoc()) {
        $cfg = json_decode($row['valor'], true);
        echo json_encode([
            "status" => "ok",
            "config_clima" => $cfg,
            "cfg_ver" => (int)$row['atualizado_em']
        ]);
    } else {
        echo json_encode(["status" => "error", "message" => "Configuracao nao encontrada"]);
    }
    $conn->close();
    exit;
}

// =======================================================
// RECEBER DADOS DO ESP32 (Modo Online ou Offline/Lote)
// =======================================================
if ($method === 'POST') {
    // Proteção de Rota (Compatível com FastCGI da HostGator)
    $apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
    
    if ($apiKey !== API_KEY) {
        http_response_code(401);
        die(json_encode(["error" => "Não autorizado. Chave API inválida."]));
    }

    $json = file_get_contents('php://input');
    $data = json_decode($json, true);
    
    if (!$data || !is_array($data)) {
        http_response_code(400);
        die(json_encode(["error" => "JSON inválido"]));
    }

    // Suporta envio de 1 leitura (online) ou várias de uma vez (ESP32 estava sem internet)
    // BUG CORRIGIDO: o lote offline (array) não tem a resposta lida pelo firmware.
    // Comandos pendentes só são entregues no envio individual (objeto), senão eram perdidos.
    $envioEmLote = isset($data[0]);
    if (!$envioEmLote) $data = [$data];

    garantirColunasExtras($conn);
    $stmt = $conn->prepare("INSERT INTO telemetria (timestamp, temp_int, hum_int, temp_ext, hum_ext, rele_luz, rele_umid, rele_vento, rele_exaust, rele_ar, rele_vento_ext, fase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $successCount = 0;
    foreach ($data as $row) {
        if (!is_array($row)) continue; // Robustez: ignora itens que não são objetos JSON
        // Salva versão do FW num arquivo separado pra ser rápido
        if (isset($row['fw'])) {
            file_put_contents(__DIR__ . '/fw_status.txt', $row['fw']);
        }
        if (isset($row['vFirmware'])) {
            file_put_contents(__DIR__ . '/vFirmware.txt', $row['vFirmware']);
        }
        if (isset($row['board'])) {
            file_put_contents(__DIR__ . '/board_model.txt', $row['board']);
        }
        // Salva modo atual da luz se reportado
        if (isset($row['modoLuz'])) {
            file_put_contents(__DIR__ . '/modo_luz.txt', (string)(int)$row['modoLuz']);
        }
        // Salva modo atual do ar condicionado se reportado
        if (isset($row['modoAr'])) {
            file_put_contents(__DIR__ . '/modo_ar.txt', (string)(int)$row['modoAr']);
        }
        // Salva flag de erro de OTA se a placa reportar que precisou reverter
        if (isset($row['otaError']) && $row['otaError'] == 1) {
            file_put_contents(__DIR__ . '/fw_error.txt', '1');
        } else {
            @unlink(__DIR__ . '/fw_error.txt');
        }

        // Se o ESP32 gravou o UNIX timestamp (offline), usamos ele. Senão, hora de agora.
        // Robustez PHP 8: timestamp não numérico gerava TypeError (HTTP 500) e travava o lote offline
        $ts = (isset($row['timestamp']) && is_numeric($row['timestamp']) && $row['timestamp'] > 0) ? date('Y-m-d H:i:s', (int)$row['timestamp']) : date('Y-m-d H:i:s');
        
        // Filtro de sanidade: descarta apenas se o sensor INTERNO (crítico) estiver com leitura fisicamente impossível.
        // Sensor externo (DHT11) com falha envia -99; apenas zeramos os campos externos sem descartar o registro inteiro.
        if (!isset($row['tI']) || !is_numeric($row['tI']) || !isset($row['uI']) || !is_numeric($row['uI'])) continue;
        if ($row['uI'] > 100 || $row['uI'] < 0) continue;
        if ($row['tI'] < -10 || $row['tI'] > 60) continue;

        // Sensor externo: se fora do range fisicamente possível (ex: -99 de falha), grava como NULL em vez de descartar
        $tE = (isset($row['tE']) && is_numeric($row['tE']) && $row['tE'] >= -10 && $row['tE'] <= 60) ? $row['tE'] : null;
        $uE = (isset($row['uE']) && is_numeric($row['uE']) && $row['uE'] >= 0 && $row['uE'] <= 100) ? $row['uE'] : null;
        $faseRow = isset($row['fase']) && is_scalar($row['fase']) ? (string)$row['fase'] : '';

        // Sanitiza estados dos relés (0 ou 1). Elimina qualquer valor legado '2' (falta d'água)
        $rLuz = (isset($row['rLuz']) && (int)$row['rLuz'] === 1) ? 1 : 0;
        $rUmid = (isset($row['rUmid']) && (int)$row['rUmid'] === 1) ? 1 : 0;
        $rVento = (isset($row['rVento']) && (int)$row['rVento'] === 1) ? 1 : 0;
        $rExaust = (isset($row['rExaust']) && (int)$row['rExaust'] === 1) ? 1 : 0;
        $rAr = (isset($row['rAr']) && (int)$row['rAr'] === 1) ? 1 : 0;
        $rVentoExt = (isset($row['rVentoExt']) && (int)$row['rVentoExt'] === 1) ? 1 : 0;

        $stmt->bind_param("sddddiiiiiis", 
            $ts, $row['tI'], $row['uI'], $tE, $uE, 
            $rLuz, $rUmid, $rVento, $rExaust, $rAr, $rVentoExt, $faseRow
        );
        if($stmt->execute()) $successCount++;
    }
    $stmt->close();
    
    // AUTO-LIMPEZA DO BANCO DE DADOS (Anti-Crash de Disco HostGator)
    // Executa a limpeza com 1% de chance em cada requisição mantendo DIAS_RETENCAO_TELEMETRIA dias de histórico
    if (mt_rand(1, 100) === 1) {
        $conn->query("DELETE FROM telemetria WHERE timestamp < DATE_SUB(NOW(), INTERVAL " . (int)DIAS_RETENCAO_TELEMETRIA . " DAY)");
    }
    
    $resposta = ["status" => "ok", "inseridos" => $successCount];
    // Carrega configuração climática atual do banco de dados MySQL
    garantirTabelaConfig($conn);
    $resCfg = $conn->query("SELECT valor, atualizado_em FROM config_sistema WHERE chave = 'clima'");
    if ($resCfg && $rCfg = $resCfg->fetch_assoc()) {
        $resposta['config_clima'] = json_decode($rCfg['valor'], true);
        $resposta['cfg_ver'] = (int)$rCfg['atualizado_em'];
    }

    $arquivo_comando = __DIR__ . '/comando_pendente.json';
    if (!$envioEmLote && file_exists($arquivo_comando)) {
        $fpCmd = fopen($arquivo_comando, 'c+');
        if ($fpCmd !== false) {
            flock($fpCmd, LOCK_EX);
            $conteudo = '';
            fseek($fpCmd, 0);
            while (!feof($fpCmd)) $conteudo .= fread($fpCmd, 8192);
            $cmd = json_decode($conteudo, true);
            if ($cmd) {
                if (isset($cmd['fase'])) $resposta['comando_fase'] = $cmd['fase'];
                if (isset($cmd['luz'])) $resposta['comando_luz'] = $cmd['luz'];
                if (isset($cmd['ar'])) $resposta['comando_ar'] = $cmd['ar'];
                if (isset($cmd['vento_ext'])) $resposta['comando_vento_ext'] = $cmd['vento_ext'];
                if (isset($cmd['reset_agua'])) $resposta['comando_reset_agua'] = 1;
                if (isset($cmd['ota'])) $resposta['comando_ota'] = 1;
            }
            // Esvazia os comandos entregues com trava atômica para evitar conflito com comando.php
            ftruncate($fpCmd, 0);
            fflush($fpCmd);
            flock($fpCmd, LOCK_UN);
            fclose($fpCmd);
        }
    }
    
    // Auto-Update: Usa a data de modificação real do arquivo correspondente ao modelo da placa ativa
    $boardModel = file_exists(__DIR__ . '/board_model.txt') ? file_get_contents(__DIR__ . '/board_model.txt') : 'ESP32-S3';
    $arquivo_bin = caminhoBinFirmware($boardModel);
    if ($arquivo_bin) {
        $resposta['versao_nuvem'] = filemtime($arquivo_bin);
    }
    
    echo json_encode($resposta);
} 
// =======================================================
// ENTREGAR DADOS PARA O DASHBOARD (Gráficos)
// =======================================================
elseif ($method === 'GET') {
    // Ação administrativa para limpar ruídos e picos de interferência
    if (isset($_GET['limpar_ruido']) && $_GET['limpar_ruido'] === ADMIN_KEY) {
        $conn->query("DELETE FROM telemetria WHERE hum_ext > 100 OR (temp_ext < 18.5 AND hum_ext > 90)");
        $rem = $conn->affected_rows;
        die(json_encode(["status" => "ok", "removidos" => $rem]));
    }

    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1440;
    $limit = max(1, min(30000, $limit)); // Clamp: suporta 24h (1440) ou 7 dias (10080)
    
    // Multiplica a busca para cobrir pontos de 10s e garantir minutos únicos suficientes
    $queryLimit = min(50000, $limit * 6);
    // BUG CORRIGIDO: temp_ext >= 15 apagava noites frias do gráfico; agora filtra apenas
    // leituras fisicamente impossíveis (< -10°C) ou ruído extremo (hum_ext > 100).
    $sql = "SELECT * FROM telemetria WHERE (hum_ext <= 100 OR hum_ext IS NULL) AND (temp_ext >= -10 OR temp_ext IS NULL) ORDER BY id DESC LIMIT $queryLimit";
    $result = $conn->query($sql);
    
    // Headers de Versão
    $fwPlaca = file_exists(__DIR__ . '/fw_status.txt') ? file_get_contents(__DIR__ . '/fw_status.txt') : '0';
    $boardModel = file_exists(__DIR__ . '/board_model.txt') ? file_get_contents(__DIR__ . '/board_model.txt') : 'ESP32-S3';
    $binGet = caminhoBinFirmware($boardModel);
    $fwNuvem = $binGet ? (string)filemtime($binGet) : '0';
    
    // Obtém o Hash do Git da Nuvem (pasta superior)
    $gitHead = __DIR__ . '/../../.git/refs/heads/main';
    $gitHash = file_exists($gitHead) ? substr(trim(file_get_contents($gitHead)), 0, 7) : 'Desconhecido';

    header("X-Fw-Placa: " . trim($fwPlaca));
    header("X-Fw-Nuvem: " . trim($fwNuvem));
    header("X-Git-Hash: " . $gitHash);

    $rows = [];
    $seenMinutes = [];
    while($r = $result->fetch_assoc()) {
        $ts = strtotime($r['timestamp']);
        // Agrupa por minuto exato: garante estritamente 1 registro por minuto
        $minKey = date('Y-m-d H:i', $ts);
        if (isset($seenMinutes[$minKey])) continue;
        $seenMinutes[$minKey] = true;

        $r['unix_ts'] = $ts;
        // Sanitiza rele_umid, rele_ar e rele_vento_ext para 0 ou 1
        $r['rele_umid'] = ((int)$r['rele_umid'] === 1) ? 1 : 0;
        $r['rele_ar'] = (isset($r['rele_ar']) && (int)$r['rele_ar'] === 1) ? 1 : 0;
        $r['rele_vento_ext'] = (isset($r['rele_vento_ext']) && (int)$r['rele_vento_ext'] === 1) ? 1 : 0;
        $rows[] = $r;
        if (count($rows) >= $limit) break;
    }
    
    // Inverte a ordem para o gráfico ficar cronológico (da esquerda pra direita)
    $rows = array_reverse($rows);
    if (count($rows) > 0) {
        $modoLuzAtual = file_exists(__DIR__ . '/modo_luz.txt') ? (int)trim(file_get_contents(__DIR__ . '/modo_luz.txt')) : 0;
        $modoArAtual = file_exists(__DIR__ . '/modo_ar.txt') ? (int)trim(file_get_contents(__DIR__ . '/modo_ar.txt')) : 0;
        $modoVentoExtAtual = file_exists(__DIR__ . '/modo_vento_ext.txt') ? (int)trim(file_get_contents(__DIR__ . '/modo_vento_ext.txt')) : 0;
        $rows[count($rows) - 1]['modo_luz'] = $modoLuzAtual;
        $rows[count($rows) - 1]['modo_ar'] = $modoArAtual;
        $rows[count($rows) - 1]['modo_vento_ext'] = $modoVentoExtAtual;
    }
    echo json_encode($rows);
    
    // Auto-purge inteligente: roda com probabilidade de 1% (a cada ~8 minutos)
    // BUG CORRIGIDO: coluna unix_ts não existe na tabela; usar comparação DATETIME nativa
    // BUG CORRIGIDO: retenção unificada com a rotina do POST (antes 90 dias aqui vs 30 no POST)
    if (mt_rand(1, 100) === 1) {
        $conn->query("DELETE FROM telemetria WHERE timestamp < DATE_SUB(NOW(), INTERVAL " . (int)DIAS_RETENCAO_TELEMETRIA . " DAY)");
    }
}

$conn->close();
?>
