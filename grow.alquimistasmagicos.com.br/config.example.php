<?php
// =======================================================
// CONFIGURACOES DO BANCO DE DADOS (HostGator)
// =======================================================
define('DB_HOST', 'localhost');
define('DB_USER', 'SEU_USUARIO');
define('DB_PASS', 'SUA_SENHA');
define('DB_NAME', 'SEU_BANCO');

// CHAVE DE SEGURANCA (O ESP32 precisa enviar essa chave para ter permissao de gravar)
define('API_KEY', 'SUA_CHAVE_SECRETA');

// CHAVE DE ADMINISTRADOR (Dashboard → API de Comandos e Upload de Firmware)
// Deve ser diferente da API_KEY do ESP32!
define('ADMIN_KEY', 'SUA_CHAVE_ADMIN');
?>


