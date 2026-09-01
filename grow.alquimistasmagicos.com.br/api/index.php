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
        // Se o ESP32 gravou o UNIX timestamp (offline), usamos ele. Senão, hora de agora.
        $ts = isset($row['timestamp']) && $row['timestamp'] > 0 ? date('Y-m-d H:i:s', $row['timestamp']) : date('Y-m-d H:i:s');
        
        $stmt->bind_param("sddddiiiis", 
            $ts, $row['tI'], $row['uI'], $row['tE'], $row['uE'], 
            $row['rLuz'], $row['rUmid'], $row['rVento'], $row['rExaust'], $row['fase']
        );
        if($stmt->execute()) $successCount++;
    }
    $stmt->close();
    echo json_encode(["status" => "ok", "inseridos" => $successCount]);
} 
// =======================================================
// ENTREGAR DADOS PARA O DASHBOARD (Gráficos)
// =======================================================
elseif ($method === 'GET') {
    // Quantidade de registros. Se ESP32 envia a cada 10 min, 144 = 24 horas
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 144; 
    
    // Pega os mais recentes
    $sql = "SELECT * FROM telemetria ORDER BY id DESC LIMIT $limit";
    $result = $conn->query($sql);
    
    $rows = [];
    while($r = $result->fetch_assoc()) {
        $rows[] = $r;
    }
    
    // Inverte a ordem para o gráfico ficar cronológico (da esquerda pra direita)
    $rows = array_reverse($rows);
    echo json_encode($rows);
}

$conn->close();
?>
