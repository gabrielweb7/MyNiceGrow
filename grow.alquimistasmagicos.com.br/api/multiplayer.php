<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0775, true);
}
$storeFile = is_writable($dataDir)
    ? ($dataDir . '/mp_players.json')
    : (sys_get_temp_dir() . '/mynicegrow_mp_players.json');

$raw = file_get_contents('php://input');
$input = json_decode($raw, true);
if (!is_array($input)) {
    $input = $_POST;
}

$action = $input['action'] ?? ($_GET['action'] ?? 'sync');
$id = preg_replace('/[^a-zA-Z0-9_\-]/', '', (string)($input['id'] ?? ''));
$now = microtime(true);
$timeoutSec = 12.0;

$fp = @fopen($storeFile, 'c+');
if (!$fp) {
    echo json_encode(['ok' => false, 'players' => []]);
    exit;
}

flock($fp, LOCK_EX);
$contents = stream_get_contents($fp);
$players = $contents ? json_decode($contents, true) : [];
if (!is_array($players)) {
    $players = [];
}

// Remove inativos (> 12s sem heartbeat)
foreach ($players as $pid => $pdata) {
    if (!is_array($pdata) || ($now - ($pdata['lastSeen'] ?? 0)) > $timeoutSec) {
        unset($players[$pid]);
    }
}

if ($action === 'leave' && $id !== '') {
    unset($players[$id]);
} elseif ($action === 'sync' && $id !== '') {
    $name = mb_substr(trim((string)($input['name'] ?? 'Visitante')), 0, 22);
    if ($name === '') $name = 'Visitante';
    $players[$id] = [
        'id' => $id,
        'name' => $name,
        'color' => (int)($input['color'] ?? 0x38bdf8),
        'hatColor' => (int)($input['hatColor'] ?? 0xe11d48),
        'x' => round((float)($input['x'] ?? 1.15), 3),
        'y' => round((float)($input['y'] ?? 0.0), 3),
        'z' => round((float)($input['z'] ?? 3.4), 3),
        'yaw' => round((float)($input['yaw'] ?? 0.42), 3),
        'walking' => !empty($input['walking']),
        'inFps' => !empty($input['inFps']),
        'lastSeen' => $now
    ];
}

ftruncate($fp, 0);
rewind($fp);
fwrite($fp, json_encode($players));
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

$others = [];
foreach ($players as $pid => $pdata) {
    if ($pid !== $id) {
        $others[] = $pdata;
    }
}

echo json_encode([
    'ok' => true,
    'online' => count($players),
    'players' => $others
]);
