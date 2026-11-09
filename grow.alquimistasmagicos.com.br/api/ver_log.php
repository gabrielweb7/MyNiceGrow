<?php
header('Content-Type: text/plain');
$log = __DIR__ . '/ota_access.log';
if (file_exists($log)) {
    echo file_get_contents($log);
} else {
    echo "Nenhum acesso registrado ainda.";
}

