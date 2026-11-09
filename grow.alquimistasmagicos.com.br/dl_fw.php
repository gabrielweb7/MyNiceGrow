<?php
// Servidor de Firmware Direto para OTA do ESP32 com Telemetria de Download
date_default_timezone_set('America/Sao_Paulo');

$logFile = __DIR__ . '/api/ota_access.log';
$logEntry = date('Y-m-d H:i:s') . ' | IP: ' . ($_SERVER['REMOTE_ADDR'] ?? 'desconhecido') . ' | URI: ' . ($_SERVER['REQUEST_URI'] ?? '') . ' | UA: ' . ($_SERVER['HTTP_USER_AGENT'] ?? '') . "\n";
@file_put_contents($logFile, $logEntry, FILE_APPEND);

// Identifica qual binário servir
$uri = $_SERVER['REQUEST_URI'] ?? '';
$isS3 = (stripos($uri, 'esp32s3') !== false);
$pasta = $isS3 ? 'esp32.esp32.esp32s3' : 'esp32.esp32.esp32c3';

$candidatos = [
    __DIR__ . '/build/' . $pasta . '/esp32c3.ino.bin',
    __DIR__ . '/build/esp32.esp32.esp32s3/esp32c3.ino.bin',
    __DIR__ . '/../build/' . $pasta . '/esp32c3.ino.bin',
    __DIR__ . '/../build/esp32.esp32.esp32s3/esp32c3.ino.bin'
];

$binPath = null;
$maiorMtime = 0;
foreach ($candidatos as $c) {
    if (file_exists($c)) {
        $mt = (int)@filemtime($c);
        if ($mt > $maiorMtime) {
            $maiorMtime = $mt;
            $binPath = $c;
        }
    }
}

if (!$binPath || !file_exists($binPath)) {
    http_response_code(404);
    die("Firmware bin not found");
}

$fileSize = filesize($binPath);

// Headers otimizados para o cliente HTTPUpdate do ESP32
header('Content-Type: application/octet-stream');
header('Content-Length: ' . $fileSize);
header('Content-Disposition: attachment; filename="esp32c3.ino.bin"');
header('Connection: close');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('Pragma: no-cache');
header('Expires: 0');

// Limpa buffers para envio imediato de bytes brutos sem buffering
if (ob_get_level()) {
    ob_end_clean();
}

$fp = fopen($binPath, 'rb');
if ($fp) {
    while (!feof($fp)) {
        echo fread($fp, 8192);
        flush();
    }
    fclose($fp);
}
exit;

