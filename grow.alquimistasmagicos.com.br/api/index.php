<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Expose-Headers: X-Fw-Placa, X-Fw-Nuvem');
require_once __DIR__ . '/../config.php';

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
            "1" => ["tX" => 28.0, "uN" => 97.0, "uX" => 99.9, "fO" => 1, "fF" => 40, "vO" => 1, "vF" => 2, "vU" => 1],
            "2" => ["tX" => 29.0, "uN" => 92.0, "uX" => 94.0, "fO" => 2, "fF" => 25, "vO" => 1, "vF" => 2, "vU" => 1],
            "3" => ["tX" => 28.0, "uN" => 97.0, "uX" => 99.9, "fO" => 1, "fF" => 40, "vO" => 1, "vF" => 2, "vU" => 1]
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
        // Salva flag de erro de OTA se a placa reportar que precisou reverter
        if (isset($row['otaError']) && $row['otaError'] == 1) {
            file_put_contents(__DIR__ . '/fw_error.txt', '1');
        } else {
            @unlink(__DIR__ . '/fw_error.txt');
        }

        // Se o ESP32 gravou o UNIX timestamp (offline), usamos ele. Senão, hora de agora.
        $ts = isset($row['timestamp']) && $row['timestamp'] > 0 ? date('Y-m-d H:i:s', $row['timestamp']) : date('Y-m-d H:i:s');
        
        // Filtro de sanidade contra interferência eletromagnética (leituras corrompidas)
        if (isset($row['uE']) && ($row['uE'] > 100 || $row['uE'] < 0)) continue;
        if (isset($row['tE']) && ($row['tE'] < 0 || $row['tE'] > 60)) continue;
        if (isset($row['uI']) && ($row['uI'] > 100 || $row['uI'] < 0)) continue;
        if (isset($row['tI']) && ($row['tI'] < 0 || $row['tI'] > 60)) continue;

        $stmt->bind_param("sddddiiiis", 
            $ts, $row['tI'], $row['uI'], $row['tE'], $row['uE'], 
            $row['rLuz'], $row['rUmid'], $row['rVento'], $row['rExaust'], $row['fase']
        );
        if($stmt->execute()) $successCount++;
    }
    $stmt->close();
    
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
        $cmd = json_decode(file_get_contents($arquivo_comando), true);
        if (isset($cmd['fase'])) $resposta['comando_fase'] = $cmd['fase'];
        if (isset($cmd['luz'])) $resposta['comando_luz'] = $cmd['luz'];
        if (isset($cmd['reset_agua'])) $resposta['comando_reset_agua'] = 1;
        if (isset($cmd['ota'])) $resposta['comando_ota'] = 1;
        unlink($arquivo_comando); // Deleta comandos pontuais apos entregar ao ESP32
    }
    
    // Auto-Update: Usa a data de modificação real do arquivo no servidor
    $arquivo_bin = __DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin';
    if (file_exists($arquivo_bin)) {
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
    $limit = max(1, min(20000, $limit)); // Clamp: evita queries gigantes
    
    // Ignora leituras corrompidas por interferência física/elétrica
    $sql = "SELECT * FROM telemetria WHERE (hum_ext <= 100 OR hum_ext IS NULL) AND (temp_ext >= 15 OR temp_ext IS NULL) ORDER BY id DESC LIMIT $limit";
    $result = $conn->query($sql);
    
    // Headers de Versão
    $fwPlaca = file_exists(__DIR__ . '/fw_status.txt') ? file_get_contents(__DIR__ . '/fw_status.txt') : '0';
    $fwNuvem = file_exists(__DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin') ? filemtime(__DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin') : '0';
    
    // Obtém o Hash do Git da Nuvem (pasta superior)
    $gitHead = __DIR__ . '/../../.git/refs/heads/main';
    $gitHash = file_exists($gitHead) ? substr(trim(file_get_contents($gitHead)), 0, 7) : 'Desconhecido';

    header("X-Fw-Placa: " . trim($fwPlaca));
    header("X-Fw-Nuvem: " . trim($fwNuvem));
    header("X-Git-Hash: " . $gitHash);

    $rows = [];
    while($r = $result->fetch_assoc()) {
        $r['unix_ts'] = strtotime($r['timestamp']);
        $rows[] = $r;
    }
    
    // Inverte a ordem para o gráfico ficar cronológico (da esquerda pra direita)
    $rows = array_reverse($rows);
    echo json_encode($rows);
    
    // Auto-purge: remove registros com mais de 90 dias (executa 1x a cada GET)
    $conn->query("DELETE FROM telemetria WHERE timestamp < DATE_SUB(NOW(), INTERVAL 90 DAY)");
}

$conn->close();
?>
