<?php
require 'config.php';
$c = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if($c->connect_error) {
    echo 'Error: '.$c->connect_error;
} else {
    echo 'OK';
}
?>
