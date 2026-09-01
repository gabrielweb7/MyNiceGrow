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
    fase VARCHAR(30)
);

-- Opcional: Adicionar um índice no timestamp para as consultas do gráfico ficarem super rápidas
CREATE INDEX idx_timestamp ON telemetria(timestamp);
