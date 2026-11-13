CREATE TABLE IF NOT EXISTS telemetria (
    id INT AUTO_INCREMENT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    temp_int DECIMAL(5,2),
    hum_int DECIMAL(5,2),
    temp_ext DECIMAL(5,2),
    hum_ext DECIMAL(5,2),
    rele_luz TINYINT(1),
    rele_umid TINYINT(1),
    rele_vento TINYINT(1),
    rele_exaust TINYINT(1),
    rele_ar TINYINT(1) DEFAULT 0,
    rele_vento_ext TINYINT(1) DEFAULT 0,
    fase VARCHAR(30)
);

-- Índice no timestamp para acelerar consultas dos gráficos
CREATE INDEX idx_timestamp ON telemetria(timestamp);

CREATE TABLE IF NOT EXISTS config_sistema (
    chave VARCHAR(50) PRIMARY KEY,
    valor LONGTEXT,
    atualizado_em INT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
