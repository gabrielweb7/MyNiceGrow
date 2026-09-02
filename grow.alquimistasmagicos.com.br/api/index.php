<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
require_once __DIR__ . '/../config.php';

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    die(json_encode(["error" => "Falha na conexão com banco de dados"]));
}

$method = $_SERVER['REQUEST_METHOD'];

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

        // Se o ESP32 gravou o UNIX timestamp (offline), usamos ele. Senão, hora de agora.
        $ts = isset($row['timestamp']) && $row['timestamp'] > 0 ? date('Y-m-d H:i:s', $row['timestamp']) : date('Y-m-d H:i:s');
        
        $stmt->bind_param("sddddiiiis", 
            $ts, $row['tI'], $row['uI'], $row['tE'], $row['uE'], 
            $row['rLuz'], $row['rUmid'], $row['rVento'], $row['rExaust'], $row['fase']
        );
        if($stmt->execute()) $successCount++;
    }
    $stmt->close();
    
    $resposta = ["status" => "ok", "inseridos" => $successCount];
    $arquivo_comando = __DIR__ . '/comando_pendente.json';
    if (file_exists($arquivo_comando)) {
        $cmd = json_decode(file_get_contents($arquivo_comando), true);
        if (isset($cmd['fase'])) $resposta['comando_fase'] = $cmd['fase'];
        if (isset($cmd['luz'])) $resposta['comando_luz'] = $cmd['luz'];
        if (isset($cmd['reset_agua'])) $resposta['comando_reset_agua'] = 1;
        if (isset($cmd['ota'])) $resposta['comando_ota'] = 1;
        unlink($arquivo_comando); // Deleta apos entregar ao ESP32
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
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1440;
    $limit = max(1, min(20000, $limit)); // Clamp: evita queries gigantes
    
    $sql = "SELECT * FROM telemetria ORDER BY id DESC LIMIT $limit";
    $result = $conn->query($sql);
    
    // Headers de Versão
    $fwPlaca = file_exists(__DIR__ . '/fw_status.txt') ? file_get_contents(__DIR__ . '/fw_status.txt') : '0';
    $fwNuvem = file_exists(__DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin') ? filemtime(__DIR__ . '/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin') : '0';
    header("X-Fw-Placa: " . trim($fwPlaca));
    header("X-Fw-Nuvem: " . trim($fwNuvem));

    $rows = [];
    while($r = $result->fetch_assoc()) {
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
