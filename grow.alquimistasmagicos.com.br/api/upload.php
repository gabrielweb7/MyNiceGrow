<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');

// CORS Preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
if ($apiKey !== '@Fenix.777!') {
    http_response_code(401);
    die(json_encode(["error" => "Acesso negado. Chave invalida."]));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['firmware'])) {
    $file = $_FILES['firmware'];
    
    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
    if (strtolower($ext) !== 'bin') {
        http_response_code(400);
        die(json_encode(["error" => "Apenas arquivos .bin sao permitidos."]));
    }

    // Salva o arquivo na raiz do painel
    $destino = __DIR__ . '/../firmware.bin';
    if (move_uploaded_file($file['tmp_name'], $destino)) {
        echo json_encode(["status" => "Upload concluido com sucesso."]);
    } else {
        http_response_code(500);
        echo json_encode(["error" => "Falha ao salvar o arquivo no servidor."]);
    }
} else {
    http_response_code(400);
    echo json_encode(["error" => "Nenhum arquivo enviado."]);
}
