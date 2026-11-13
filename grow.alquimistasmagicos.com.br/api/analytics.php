<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

require_once __DIR__ . '/../config.php';

$conn = new mysqli(DB_HOST, DB_USER, DB_PASS, DB_NAME);
if ($conn->connect_error) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Falha na conexão com o banco']);
    exit;
}
$conn->set_charset('utf8mb4');

$dias = isset($_GET['dias']) ? (int)$_GET['dias'] : 30;
if ($dias < 1) $dias = 1;
if ($dias > 365) $dias = 365;

$desde = date('Y-m-d H:i:s', time() - ($dias * 86400));

// 1. Resumo geral do período
$sqlResumo = "
    SELECT
        COUNT(*) AS total_registros,
        MIN(timestamp) AS min_ts,
        MAX(timestamp) AS max_ts,
        ROUND(AVG(NULLIF(temp_int, 0)), 2) AS media_temp_int,
        ROUND(MIN(CASE WHEN temp_int > -20 THEN temp_int END), 2) AS min_temp_int,
        ROUND(MAX(CASE WHEN temp_int < 80 THEN temp_int END), 2) AS max_temp_int,
        ROUND(AVG(NULLIF(hum_int, 0)), 2) AS media_hum_int,
        ROUND(MIN(CASE WHEN hum_int > 0 THEN hum_int END), 2) AS min_hum_int,
        ROUND(AVG(CASE WHEN temp_ext > -20 AND temp_ext < 80 THEN temp_ext END), 2) AS media_temp_ext,
        ROUND(AVG(CASE WHEN hum_ext > 0 THEN hum_ext END), 2) AS media_hum_ext,
        SUM(CASE WHEN rele_luz = 1 THEN 1 ELSE 0 END) AS min_luz,
        SUM(CASE WHEN rele_umid = 1 THEN 1 ELSE 0 END) AS min_umid,
        SUM(CASE WHEN rele_vento = 1 THEN 1 ELSE 0 END) AS min_vento,
        SUM(CASE WHEN rele_exaust = 1 THEN 1 ELSE 0 END) AS min_exaust,
        SUM(CASE WHEN rele_ar = 1 THEN 1 ELSE 0 END) AS min_ar,
        SUM(CASE WHEN hum_int >= 95 THEN 1 ELSE 0 END) AS reg_hum_95,
        SUM(CASE WHEN temp_int <= 28.0 AND temp_int >= 20.0 THEN 1 ELSE 0 END) AS reg_temp_ideal,
        SUM(CASE WHEN temp_int >= 30.0 THEN 1 ELSE 0 END) AS reg_calor_critico,
        SUM(CASE WHEN temp_int <= 24.0 AND temp_int > -20 THEN 1 ELSE 0 END) AS reg_frio_critico,
        SUM(CASE WHEN temp_ext <= -30 OR temp_ext IS NULL THEN 1 ELSE 0 END) AS reg_ext_offline
    FROM telemetria
    WHERE timestamp >= ?
";
$stmt = $conn->prepare($sqlResumo);
$stmt->bind_param('s', $desde);
$stmt->execute();
$resumo = $stmt->get_result()->fetch_assoc();
$stmt->close();

// 2. Agregação diária
$sqlDiario = "
    SELECT
        DATE(timestamp) AS dia,
        COUNT(*) AS registros,
        ROUND(AVG(temp_int), 2) AS temp_int_med,
        ROUND(MIN(temp_int), 2) AS temp_int_min,
        ROUND(MAX(temp_int), 2) AS temp_int_max,
        ROUND(AVG(CASE WHEN temp_ext > -20 THEN temp_ext END), 2) AS temp_ext_med,
        ROUND(AVG(hum_int), 2) AS hum_int_med,
        SUM(CASE WHEN rele_ar = 1 THEN 1 ELSE 0 END) AS min_ar,
        SUM(CASE WHEN rele_exaust = 1 THEN 1 ELSE 0 END) AS min_exaust,
        SUM(CASE WHEN rele_umid = 1 THEN 1 ELSE 0 END) AS min_umid,
        SUM(CASE WHEN rele_luz = 1 THEN 1 ELSE 0 END) AS min_luz
    FROM telemetria
    WHERE timestamp >= ?
    GROUP BY DATE(timestamp)
    ORDER BY dia ASC
";
$stmt = $conn->prepare($sqlDiario);
$stmt->bind_param('s', $desde);
$stmt->execute();
$diario = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// 3. Heatmap 24h x 7 dias da semana (1=Dom .. 7=Sab)
$sqlHeat = "
    SELECT
        DAYOFWEEK(timestamp) AS dow,
        HOUR(timestamp) AS hora,
        ROUND(AVG(temp_int), 2) AS temp_int_med,
        ROUND(AVG(CASE WHEN temp_ext > -20 THEN temp_ext END), 2) AS temp_ext_med,
        ROUND(100.0 * AVG(rele_ar), 1) AS pct_ar
    FROM telemetria
    WHERE timestamp >= ?
    GROUP BY DAYOFWEEK(timestamp), HOUR(timestamp)
    ORDER BY dow ASC, hora ASC
";
$stmt = $conn->prepare($sqlHeat);
$stmt->bind_param('s', $desde);
$stmt->execute();
$heatmap = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// 4. Dispersão Quarto x Estufa (amostragem horária, Luz ON vs OFF)
$sqlScatter = "
    SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') AS hora_slot,
        ROUND(AVG(CASE WHEN temp_ext > -20 THEN temp_ext END), 2) AS temp_ext,
        ROUND(AVG(temp_int), 2) AS temp_int,
        ROUND(AVG(hum_int), 1) AS hum_int,
        MAX(rele_luz) AS luz_on
    FROM telemetria
    WHERE timestamp >= ? AND temp_ext > -20 AND temp_int > -20
    GROUP BY hora_slot
    ORDER BY hora_slot ASC
    LIMIT 720
";
$stmt = $conn->prepare($sqlScatter);
$stmt->bind_param('s', $desde);
$stmt->execute();
$scatter = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// 5. Time-lapse 3D (últimas 24h em blocos de 5 minutos, até 288 pontos)
$desde24h = date('Y-m-d H:i:s', time() - 86400);
$sqlTimelapse = "
    SELECT
        FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(timestamp) / 300) * 300) AS slot,
        ROUND(AVG(temp_int), 2) AS temp_int,
        ROUND(AVG(hum_int), 1) AS hum_int,
        ROUND(AVG(CASE WHEN temp_ext > -20 THEN temp_ext END), 2) AS temp_ext,
        ROUND(AVG(hum_ext), 1) AS hum_ext,
        MAX(rele_luz) AS rele_luz,
        MAX(rele_umid) AS rele_umid,
        MAX(rele_vento) AS rele_vento,
        MAX(rele_exaust) AS rele_exaust,
        MAX(rele_ar) AS rele_ar
    FROM telemetria
    WHERE timestamp >= ?
    GROUP BY FLOOR(UNIX_TIMESTAMP(timestamp) / 300)
    ORDER BY slot ASC
    LIMIT 300
";
$stmt = $conn->prepare($sqlTimelapse);
$stmt->bind_param('s', $desde24h);
$stmt->execute();
$timelapse = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

// 6. Segurança: gaps de conexão (> 180s) nas últimas 72h + último registro + config_clima
$desde72h = date('Y-m-d H:i:s', time() - (3 * 86400));
$sqlGaps = "
    SELECT UNIX_TIMESTAMP(timestamp) AS ts, timestamp, temp_int, hum_int, temp_ext, rele_ar, rele_luz, fase
    FROM telemetria
    WHERE timestamp >= ?
    ORDER BY timestamp ASC
";
$stmt = $conn->prepare($sqlGaps);
$stmt->bind_param('s', $desde72h);
$stmt->execute();
$rows72h = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
$stmt->close();

$gaps = [];
$maiorGapMin = 0;
$ciclosAc72h = 0;
$ciclosCurtosAc = 0;
$prevTs = null;
$prevAr = 0;
$arInicioTs = null;

foreach ($rows72h as $r) {
    $ts = (int)$r['ts'];
    if ($prevTs !== null) {
        $diff = $ts - $prevTs;
        if ($diff > 180) {
            $minGap = round($diff / 60, 1);
            if ($minGap > $maiorGapMin) $maiorGapMin = $minGap;
            $gaps[] = [
                'inicio' => date('d/m H:i', $prevTs),
                'fim' => date('d/m H:i', $ts),
                'minutos' => $minGap
            ];
        }
    }
    $ar = (int)$r['rele_ar'];
    if ($ar === 1 && $prevAr === 0) {
        $ciclosAc72h++;
        $arInicioTs = $ts;
    } elseif ($ar === 0 && $prevAr === 1 && $arInicioTs !== null) {
        if (($ts - $arInicioTs) < 300) $ciclosCurtosAc++;
        $arInicioTs = null;
    }
    $prevAr = $ar;
    $prevTs = $ts;
}

$ultimo = count($rows72h) > 0 ? $rows72h[count($rows72h) - 1] : null;

$configClima = null;
$resCfg = $conn->query("SELECT valor FROM config_sistema WHERE chave = 'clima'");
if ($resCfg && $rowCfg = $resCfg->fetch_assoc()) {
    $configClima = json_decode($rowCfg['valor'], true);
}

$conn->close();

echo json_encode([
    'status' => 'ok',
    'dias' => $dias,
    'resumo' => $resumo,
    'diario' => $diario,
    'heatmap' => $heatmap,
    'scatter' => $scatter,
    'timelapse' => $timelapse,
    'seguranca' => [
        'total_gaps_72h' => count($gaps),
        'maior_gap_min' => $maiorGapMin,
        'ultimos_gaps' => array_slice(array_reverse($gaps), 0, 10),
        'ciclos_ac_72h' => $ciclosAc72h,
        'ciclos_curtos_ac_72h' => $ciclosCurtosAc,
        'ultimo' => $ultimo,
        'config_clima' => $configClima
    ]
]);

