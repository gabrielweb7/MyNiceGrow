<?php
date_default_timezone_set('America/Sao_Paulo');
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");

function lerTxtStatus($nome, $padrao = '') {
    $locais = [
        __DIR__ . '/' . $nome,
        __DIR__ . '/../grow.alquimistasmagicos.com.br/api/' . $nome,
        __DIR__ . '/../../grow.alquimistasmagicos.com.br/api/' . $nome,
        __DIR__ . '/../api/' . $nome
    ];
    foreach ($locais as $l) {
        if (file_exists($l)) {
            $c = trim(@file_get_contents($l));
            if ($c !== '') return $c;
        }
    }
    return $padrao;
}

$fwPlaca = lerTxtStatus("fw_status.txt", "0");
$board = lerTxtStatus("board_model.txt", "ESP32-C3");
$pastaBin = (stripos($board, 'C3') !== false) ? "esp32.esp32.esp32c3" : "esp32.esp32.esp32s3";
$candidatos_bin = [
    __DIR__ . "/../build/" . $pastaBin . "/esp32c3.ino.bin",
    __DIR__ . "/../../build/" . $pastaBin . "/esp32c3.ino.bin",
    __DIR__ . "/../grow.alquimistasmagicos.com.br/build/" . $pastaBin . "/esp32c3.ino.bin"
];
$binPath = null;
$maiorMtime = 0;
foreach ($candidatos_bin as $c) {
    if (file_exists($c)) {
        $mt = (int)@filemtime($c);
        if ($mt > $maiorMtime) {
            $maiorMtime = $mt;
            $binPath = $c;
        }
    }
}
$fwNuvem = $binPath ? (string)filemtime($binPath) : "0";
if ((int)$fwPlaca > time() + 300 && (int)$fwNuvem > 0) {
    $fwPlaca = $fwNuvem;
}
$fwError = lerTxtStatus("fw_error.txt", "0");

$gitCandidatos = [
    __DIR__ . '/../.git/refs/heads/main',
    __DIR__ . '/../../.git/refs/heads/main'
];
$gitHash = 'Desconhecido';
foreach ($gitCandidatos as $g) {
    if (file_exists($g)) {
        $gitHash = substr(trim(file_get_contents($g)), 0, 7);
        break;
    }
}

$modoLuz = (int)lerTxtStatus("modo_luz.txt", "0");
$modoAr = (int)lerTxtStatus("modo_ar.txt", "0");
$vFirmware = lerTxtStatus("vFirmware.txt", "v438");
$canRollback = (int)lerTxtStatus("can_rollback.txt", "0");

echo json_encode([
    "placa" => $fwPlaca,
    "nuvem" => $fwNuvem,
    "error" => $fwError,
    "gitHash" => $gitHash,
    "modoLuz" => $modoLuz,
    "modoAr" => $modoAr,
    "vFirmware" => $vFirmware,
    "board" => $board,
    "canRollback" => $canRollback,
    "vFirmwareNuvem" => "v439"
]);


