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

$arquivo_comando = __DIR__ . '/comando_pendente.json';

// SEGURANÇA: Exige a chave secreta para aceitar comandos
// Nota: Usa $_SERVER porque apache_request_headers() crasha no FastCGI da HostGator
$apiKey = isset($_SERVER['HTTP_X_API_KEY']) ? $_SERVER['HTTP_X_API_KEY'] : '';
if ($apiKey !== '@Fenix.777!') {
    http_response_code(401);
    echo json_encode(["error" => "Acesso negado. Chave invalida."]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $cmd = [];
    if (file_exists($arquivo_comando)) {
        $cmd = json_decode(file_get_contents($arquivo_comando), true) ?: [];
    }

    if (isset($_POST['fase'])) $cmd['fase'] = (int)$_POST['fase'];
    if (isset($_POST['luz'])) $cmd['luz'] = (int)$_POST['luz']; // 0: AUTO, 1: ON, 2: OFF
    if (isset($_POST['reset_agua'])) $cmd['reset_agua'] = 1;
    if (isset($_POST['ota'])) $cmd['ota'] = 1;
    if (isset($_POST['config'])) {
        $jsonStr = $_POST['config'];
        $cmd['config_clima'] = json_decode($jsonStr, true);
        file_put_contents(__DIR__ . '/config_clima.json', $jsonStr);
    }

    file_put_contents($arquivo_comando, json_encode($cmd));
    echo json_encode(["status" => "Comando salvo na fila!", "cmd" => $cmd]);
}
