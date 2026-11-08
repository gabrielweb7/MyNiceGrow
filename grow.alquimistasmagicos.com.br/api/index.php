<?php
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

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(["error" => "Falha na conexão com banco de dados"]));
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
    
    if (!$data) {
        http_response_code(400);
        die(json_encode(["error" => "JSON inválido"]));
    }

    // Suporta envio de 1 leitura (online) ou várias de uma vez (ESP32 estava sem internet)
    if (!isset($data[0])) $data = [$data];

    $stmt = $conn->prepare("INSERT INTO telemetria (timestamp, temp_int, hum_int, temp_ext, hum_ext, rele_luz, rele_umid, rele_vento, rele_exaust, fase) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");

    $successCount = 0;
    foreach ($data as $row) {
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
        // Salva flag de erro de OTA se a placa reportar que precisou reverter
        if (isset($row['otaError']) && $row['otaError'] == 1) {
            file_put_contents(__DIR__ . '/fw_error.txt', '1');
        } else {
            @unlink(__DIR__ . '/fw_error.txt');
        }

        // Se o ESP32 gravou o UNIX timestamp (offline), usamos ele. Senão, hora de agora.
        $ts = isset($row['timestamp']) && $row['timestamp'] > 0 ? date('Y-m-d H:i:s', $row['timestamp']) : date('Y-m-d H:i:s');
        
        // Filtro de sanidade: descarta apenas se o sensor INTERNO (crítico) estiver com leitura fisicamente impossível.
        // Sensor externo (DHT11) com falha envia -99; apenas zeramos os campos externos sem descartar o registro inteiro.
        if (isset($row['uI']) && ($row['uI'] > 100 || $row['uI'] < 0)) continue;
        if (isset($row['tI']) && ($row['tI'] < -10 || $row['tI'] > 60)) continue;

        // Sensor externo: se fora do range fisicamente possível (ex: -99 de falha), grava como NULL em vez de descartar
        $tE = (isset($row['tE']) && $row['tE'] >= -10 && $row['tE'] <= 60) ? $row['tE'] : null;
        $uE = (isset($row['uE']) && $row['uE'] >= 0 && $row['uE'] <= 100) ? $row['uE'] : null;

        // Sanitiza estados dos relés (0 ou 1). Elimina qualquer valor legado '2' (falta d'água)
        $rLuz = (isset($row['rLuz']) && (int)$row['rLuz'] === 1) ? 1 : 0;
        $rUmid = (isset($row['rUmid']) && (int)$row['rUmid'] === 1) ? 1 : 0;
        $rVento = (isset($row['rVento']) && (int)$row['rVento'] === 1) ? 1 : 0;
        $rExaust = (isset($row['rExaust']) && (int)$row['rExaust'] === 1) ? 1 : 0;

        $stmt->bind_param("sddddiiiis", 
            $ts, $row['tI'], $row['uI'], $tE, $uE, 
            $rLuz, $rUmid, $rVento, $rExaust, $row['fase']
        );
        if($stmt->execute()) $successCount++;
    }
    $stmt->close();
    
    // AUTO-LIMPEZA DO BANCO DE DADOS (Anti-Crash de Disco HostGator)
    // Executa a limpeza com 5% de chance em cada requisição para não pesar o servidor
    if (rand(1, 100) <= 5) {
        // Apaga dados mais antigos que 15 dias usando comparação DATETIME nativa do MySQL
        $conn->query("DELETE FROM telemetria WHERE timestamp < DATE_SUB(NOW(), INTERVAL 15 DAY)");
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
    if (file_exists($arquivo_comando)) {
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
                if (isset($cmd['reset_agua'])) $resposta['comando_reset_agua'] = 1;
                if (isset($cmd['ota'])) $resposta['comando_ota'] = 1;
                if (isset($cmd['heater'])) $resposta['comando_heater'] = 1;
            }
            // Esvazia os comandos entregues com trava atômica para evitar conflito com comando.php
            ftruncate($fpCmd, 0);
            fflush($fpCmd);
            flock($fpCmd, LOCK_UN);
            fclose($fpCmd);
        }
    }
    
    // Auto-Update: Usa a data de modificação real do arquivo no servidor
    // Suporta build tanto na raiz quanto na pasta do subdomínio para ESP32-S3 e ESP32-C3
    $candidatos_bin = [
        __DIR__ . '/../../build/esp32.esp32.esp32s3/esp32c3.ino.bin',
        __DIR__ . '/../build/esp32.esp32.esp32s3/esp32c3.ino.bin',
        __DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin',
        __DIR__ . '/../build/esp32.esp32.esp32c3/esp32c3.ino.bin'
    ];
    $arquivo_bin = null;
    foreach ($candidatos_bin as $c) {
        if (file_exists($c)) {
            $arquivo_bin = $c;
            break;
        }
    }
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
    $candidatos_bin = [
        __DIR__ . '/../../build/esp32.esp32.esp32s3/esp32c3.ino.bin',
        __DIR__ . '/../build/esp32.esp32.esp32s3/esp32c3.ino.bin',
        __DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin',
        __DIR__ . '/../build/esp32.esp32.esp32c3/esp32c3.ino.bin'
    ];
    $fwNuvem = '0';
    foreach ($candidatos_bin as $c) {
        if (file_exists($c)) {
            $fwNuvem = (string)filemtime($c);
            break;
        }
    }
    
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
        // Sanitiza rele_umid para 0 ou 1 caso haja registros legados com valor 2 (antiga falta d'água)
        $r['rele_umid'] = ((int)$r['rele_umid'] === 1) ? 1 : 0;
        $rows[] = $r;
        if (count($rows) >= $limit) break;
    }
    
    // Inverte a ordem para o gráfico ficar cronológico (da esquerda pra direita)
    $rows = array_reverse($rows);
    if (count($rows) > 0) {
        $modoLuzAtual = file_exists(__DIR__ . '/modo_luz.txt') ? (int)trim(file_get_contents(__DIR__ . '/modo_luz.txt')) : 0;
        $rows[count($rows) - 1]['modo_luz'] = $modoLuzAtual;
    }
    echo json_encode($rows);
    
    // Auto-purge inteligente: roda com probabilidade de 1% (a cada ~8 minutos)
    // BUG CORRIGIDO: coluna unix_ts não existe na tabela; usar comparação DATETIME nativa
    if (mt_rand(1, 100) === 1) {
        $conn->query("DELETE FROM telemetria WHERE timestamp < DATE_SUB(NOW(), INTERVAL 90 DAY)");
    }
}

$conn->close();
?>
