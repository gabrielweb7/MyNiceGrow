<?php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
$fwPlaca = file_exists(__DIR__ . "/fw_status.txt") ? file_get_contents(__DIR__ . "/fw_status.txt") : "0";
$fwNuvem = file_exists(__DIR__ . "/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin") ? filemtime(__DIR__ . "/../../build/esp32.esp32.esp32c3/esp32c3.ino.bin") : "0";
$fwError = file_exists(__DIR__ . "/fw_error.txt") ? "1" : "0";
$gitHead = __DIR__ . '/../../.git/refs/heads/main';
$gitHash = file_exists($gitHead) ? substr(trim(file_get_contents($gitHead)), 0, 7) : 'Desconhecido';
echo json_encode(["placa" => trim($fwPlaca), "nuvem" => trim($fwNuvem), "error" => $fwError, "gitHash" => $gitHash]);

