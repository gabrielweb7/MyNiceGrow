<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0775, true);
}
$storeDir = is_writable($dataDir) ? $dataDir : sys_get_temp_dir();
$storeFile = $storeDir . '/mynicegrow_mp_players.json';
$worldFile = $storeDir . '/mynicegrow_mp_world.json';

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
        'pitch' => round((float)($input['pitch'] ?? 0.0), 3),
        'holdingRock' => isset($input['holdingRock']) ? (int)$input['holdingRock'] : -1,
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

$worldRocks = [];
$worldResetSeq = 0;
$wfp = @fopen($worldFile, 'c+');
if ($wfp) {
    flock($wfp, LOCK_EX);
    $wc = stream_get_contents($wfp);
    $wdata = $wc ? json_decode($wc, true) : [];
    if (!is_array($wdata)) $wdata = [];
    if (!isset($wdata['rocks']) || !is_array($wdata['rocks'])) $wdata['rocks'] = [];
    $worldResetSeq = (int)($wdata['resetSeq'] ?? 0);

    if ($action === 'reset_world') {
        $wdata['rocks'] = [];
        $worldResetSeq++;
        $wdata['resetSeq'] = $worldResetSeq;
        ftruncate($wfp, 0);
        rewind($wfp);
        fwrite($wfp, json_encode($wdata));
        fflush($wfp);
    } else {
        $saveItems = [];
        if (!empty($input['droppedRock']) && is_array($input['droppedRock'])) {
            $saveItems[] = $input['droppedRock'];
        }
        if (!empty($input['droppedItems']) && is_array($input['droppedItems'])) {
            foreach ($input['droppedItems'] as $di) {
                if (is_array($di)) $saveItems[] = $di;
            }
        }
        if (!empty($saveItems)) {
            foreach ($saveItems as $dr) {
                $rid = (int)($dr['id'] ?? -1);
                if ($rid >= 0 && $rid < 256 && isset($dr['x'], $dr['y'], $dr['z'])) {
                    $wdata['rocks'][(string)$rid] = [
                        round((float)$dr['x'], 3),
                        round((float)$dr['y'], 3),
                        round((float)$dr['z'], 3),
                        round((float)($dr['ry'] ?? 0), 3)
                    ];
                }
            }
            ftruncate($wfp, 0);
            rewind($wfp);
            fwrite($wfp, json_encode($wdata));
            fflush($wfp);
        }
    }
    $worldRocks = $wdata['rocks'];
    flock($wfp, LOCK_UN);
    fclose($wfp);
}

$others = [];
foreach ($players as $pid => $pdata) {
    if ($pid !== $id) {
        $others[] = $pdata;
    }
}

echo json_encode([
    'ok' => true,
    'online' => count($players),
    'players' => $others,
    'rocks' => $worldRocks,
    'resetSeq' => $worldResetSeq
]);

