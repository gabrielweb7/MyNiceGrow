/**
 * twin3d.js — Gêmeo Digital 3D Realista do Quarto de Cultivo (Three.js)
 * Fiel ao setup real:
 * - Quarto iluminado com piso cerâmico, paredes claras, janela com persiana e Ar-Condicionado Split Inverter acima da janela
 * - Estufa Master Tents com 2 estantes internas de blocos de cogumelos
 * - Exaustor no TOPO empurrando ar para dentro da estufa e saindo pelo duto sanfonado inferior esquerdo
 * - Estante lateral direita com Umidificador + mangueira amarela entrando no topo da estufa, potes e frascos
 * - Estante aramada de spawns com sacos de grãos dourados e placas de Petri
 * - Física de fluidos contínua (partículas não somem) colorida pela temperatura local
 */
(function () {
    let scene, camera, renderer, container;
    let initialized = false;
    let simTime = 0;

    let ledBarMat, ledLight, ledConeMat, ambientLight;
    let mylarMatRef, trayMatRef;
    let ventoHelice, exaustHelice;
    let acVaneMat, acLedMat, acVanePivot;
    let espHeartbeatMat, relayLedMats = {};
    let roomThermDisplay, tentThermDisplay;
    let frontWallGroup; // Parede frontal + porta (visível apenas no modo FPS ou zoom afastado)
    let cabinRoofGroup; // Telhado e chaminé da casa da lagoa (visível no FPS ou zoom afastado)
    let tentGroup = null;
    let roomDoorPivot, roomDoorOpen = false, roomDoorAngle = 0;
    let fpsHandsGroup, fpsHandL, fpsHandR;
    let heldRock = null, grabAnim = 0, heldYawOffset = 0;
    const fallingRocks = [];
    const pickableRocks = [];
    const pickableItems = [];
    const shelfUnits = [];
    let snapPreviewMesh = null;
    let hoverAuraGroup = null, hoverAuraMat = null, hoverEdgeMat = null;
    let hoverRay = null, hoverCenter = null, hoverBox = null, hoverSize = null, hoverPos = null;
    let lastSnapTarget = null;
    let pendingDroppedRock = null;
    const pendingDroppedItems = [];
    let waterTexRef;
    const lakeMists = [];
    let streamlinesGroup, showStreamlines = false;
    const flowArrows = [];
    const interactiveMeshes = [];
    const mushrooms = []; // Cogumelos animados (pin -> crescimento -> flush -> reinício)

    // Sistema UNIFICADO de fluido (o mesmo ar circula entre o quarto, exaustor superior, estufa e duto inferior)
    const AIR_COUNT = 880;
    const TENT_SEED = 260;
    let airPoints, airPos, airCol;
    let airLines, airLinePos, airLineCol;
    const airParticles = [];

    // Emissor dedicado de névoa na mangueira amarela (não rouba partículas suspensas do ar!)
    const MIST_COUNT = 75;
    let mistPoints, mistPos;
    const mistParticles = [];

    const state = {
        tempInt: 26.5,
        tempExt: 25.0,
        humInt: 95.0,
        luz: false,
        umid: false,
        vento: false,
        exaust: false,
        ar: false
    };

    const cam = {
        mode: 'orbit', // 'orbit' | 'fps'
        theta: 0.35,
        phi: 1.15,
        radius: 6.4,
        targetTheta: 0.35,
        targetPhi: 1.15,
        targetRadius: 6.4,
        lookX: 0.15,
        lookY: 1.22,
        lookZ: -0.35,
        targetLookX: 0.15,
        targetLookY: 1.22,
        targetLookZ: -0.35,
        // Estado FPS (primeira pessoa dentro do quarto)
        fpsX: 0.45,
        fpsY: 1.65,
        fpsZ: 1.65,
        fpsVelY: 0,
        fpsGrounded: true,
        fpsYaw: 0.12,
        fpsPitch: -0.06,
        keys: { w: false, s: false, a: false, d: false, shift: false, lookL: false, lookR: false, lookU: false, lookD: false },
        joyX: 0,
        joyY: 0,
        dragging: false,
        downX: 0,
        downY: 0,
        lastX: 0,
        lastY: 0,
        pinchDist: 0,
        autoRotate: false
    };

    function tagInteractive(obj, equipId) {
        obj.traverse(child => {
            if (child.isMesh) {
                child.userData.equipId = equipId;
                if (interactiveMeshes.indexOf(child) === -1) interactiveMeshes.push(child);
            }
        });
    }

    function registerPickable(obj, opts) {
        const o = opts || {};
        obj.userData.isPickable = true;
        obj.userData.halfH = typeof o.halfH === 'number' ? o.halfH : 0.12;
        obj.userData.holdDist = o.holdDist || 1.45;
        obj.userData.isShelf = !!o.isShelf;
        obj.userData.shelfLevels = o.shelfLevels || null;
        obj.userData.halfW = o.halfW || 0.5;
        obj.userData.halfD = o.halfD || 0.3;
        obj.userData.supportedBy = o.supportedBy || null;
        obj.userData.snapToWall = !!o.snapToWall;
        if (o.rockIndex !== undefined) {
            obj.userData.isPickableRock = true;
            obj.userData.rockIndex = o.rockIndex;
        }
        obj.traverse(child => {
            if (child.isMesh) {
                child.userData.pickRoot = obj;
                if (interactiveMeshes.indexOf(child) === -1) interactiveMeshes.push(child);
            }
        });
        if (pickableItems.indexOf(obj) === -1) {
            obj.userData.itemIndex = pickableItems.length;
            obj.userData.homePos = obj.position.clone();
            obj.userData.homeRotY = obj.rotation.y;
            obj.userData.homeSupportedBy = o.supportedBy || null;
            pickableItems.push(obj);
        }
        if (obj.userData.isShelf && shelfUnits.indexOf(obj) === -1) shelfUnits.push(obj);
        return obj;
    }

    function dropUnsupportedItems(shelfObj) {
        if (!shelfObj) return;
        const sx = shelfObj.position.x, sz = shelfObj.position.z;
        const hw = (shelfObj.userData.halfW || 0.55) + 0.12;
        const hd = (shelfObj.userData.halfD || 0.35) + 0.12;
        for (let i = 0; i < pickableItems.length; i++) {
            const it = pickableItems[i];
            if (!it || it === shelfObj || it === heldRock) continue;
            const onShelfRef = it.userData.supportedBy === shelfObj;
            const aboveBox = Math.abs(it.position.x - sx) <= hw && Math.abs(it.position.z - sz) <= hd && it.position.y > shelfObj.position.y + 0.08;
            if (onShelfRef || aboveBox) {
                it.userData.supportedBy = null;
                it.userData.velY = 0;
                if (fallingRocks.indexOf(it) === -1) fallingRocks.push(it);
            }
        }
    }

    function findPlacementTarget(item) {
        if (!item || !camera) return null;
        const origin = camera.position.clone();
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        const maxDist = item.userData.isShelf ? 5.2 : 5.0;
        const itemHalfH = item.userData.halfH || 0;

        // 1. Verifica encaixe em prateleiras (apenas se o item não for uma estante)
        if (!item.userData.isShelf && dir.y < 0.35) {
            let bestShelfHit = null;
            for (let i = 0; i < shelfUnits.length; i++) {
                const sh = shelfUnits[i];
                if (!sh || sh === item || !sh.userData.shelfLevels) continue;
                const levels = sh.userData.shelfLevels;
                const cosY = Math.cos(-sh.rotation.y), sinY = Math.sin(-sh.rotation.y);
                for (let l = 0; l < levels.length; l++) {
                    const planeY = sh.position.y + levels[l];
                    if (Math.abs(dir.y) < 0.02) continue;
                    const t = (planeY - origin.y) / dir.y;
                    if (t < 0.4 || t > maxDist) continue;
                    const hx = origin.x + dir.x * t;
                    const hz = origin.z + dir.z * t;
                    const dx = hx - sh.position.x, dz = hz - sh.position.z;
                    const lx = dx * cosY - dz * sinY;
                    const lz = dx * sinY + dz * cosY;
                    const marginW = (sh.userData.halfW || 0.45) - 0.06;
                    const marginD = (sh.userData.halfD || 0.25) - 0.05;
                    if (Math.abs(lx) <= marginW && Math.abs(lz) <= marginD) {
                        if (!bestShelfHit || t < bestShelfHit.t) {
                            bestShelfHit = {
                                t,
                                x: hx,
                                y: planeY + itemHalfH,
                                z: hz,
                                planeY,
                                shelf: sh
                            };
                        }
                    }
                }
            }
            if (bestShelfHit) return bestShelfHit;
        }

        // 2. Encaixe na parede (para o Ar-Condicionado)
        if (item.userData.snapToWall && dir.y > -0.25) {
            // Parede esquerda x = -2.42, parede fundo z = -2.02
            if (dir.x < -0.2) {
                const t = (-2.42 - origin.x) / dir.x;
                if (t > 0.5 && t < 5.5) {
                    const hy = origin.y + dir.y * t;
                    const hz = origin.z + dir.z * t;
                    if (hy > 1.3 && hy < 3.1 && hz > -2.0 && hz < 2.0) {
                        return { t, x: -2.42, y: hy, z: hz, planeY: hy - 0.17, shelf: null, wallRotY: 0 };
                    }
                }
            }
            if (dir.z < -0.2) {
                const t = (-2.02 - origin.z) / dir.z;
                if (t > 0.5 && t < 5.5) {
                    const hx = origin.x + dir.x * t;
                    const hy = origin.y + dir.y * t;
                    if (hy > 1.3 && hy < 3.1 && hx > -2.3 && hx < 3.1) {
                        return { t, x: hx, y: hy, z: -2.02, planeY: hy - 0.17, shelf: null, wallRotY: -Math.PI / 2 };
                    }
                }
            }
        }

        // 3. Encaixe em cima de qualquer outro objeto sólido (empilhar/apoiar em cima das coisas)
        if (hoverRay && interactiveMeshes.length) {
            hoverRay.setFromCamera(hoverCenter, camera);
            const objHits = hoverRay.intersectObjects(interactiveMeshes, false);
            for (let h = 0; h < objHits.length; h++) {
                const hit = objHits[h];
                if (hit.distance > maxDist) break;
                const hObj = hit.object;
                if (hObj.userData.equipId === 'porta') continue;
                const hitRoot = hObj.userData.pickRoot || (hObj.userData.isPickable ? hObj : null);
                if (!hitRoot || hitRoot === item) continue;
                let worldNy = 0;
                if (hit.face) {
                    const nMat = new THREE.Matrix3().getNormalMatrix(hObj.matrixWorld);
                    const wn = hit.face.normal.clone().applyMatrix3(nMat).normalize();
                    worldNy = wn.y;
                }
                if (!hoverBox) hoverBox = new THREE.Box3();
                hoverBox.setFromObject(hitRoot);
                if (worldNy > 0.42 || hit.point.y >= hoverBox.max.y - 0.14) {
                    const topY = Math.max(hit.point.y, hoverBox.max.y - 0.01);
                    return {
                        t: hit.distance,
                        x: hit.point.x,
                        y: topY + itemHalfH,
                        z: hit.point.z,
                        planeY: topY,
                        shelf: hitRoot
                    };
                }
            }
        }

        // 4. Encaixe no chão / piso da casa / deck
        if (dir.y < -0.05) {
            const approxFloor = Math.max(-0.2, getGroundHeight(origin.x + dir.x * 2.5, origin.z + dir.z * 2.5));
            const t = (approxFloor - origin.y) / dir.y;
            if (t > 0.4 && t < maxDist) {
                const hx = origin.x + dir.x * t;
                const hz = origin.z + dir.z * t;
                const gh = getGroundHeight(hx, hz);
                if (gh >= -0.22) {
                    return {
                        t,
                        x: hx,
                        y: gh + itemHalfH,
                        z: hz,
                        planeY: gh + 0.015,
                        shelf: null
                    };
                }
            }
        }
        return null;
    }

    // Dimensões da estufa (centrada em x = -0.35, z = -0.25)
    const GX = -0.35, GZ = -0.25;
    const W = 1.45, H = 2.35, D = 1.25;
    const halfW = W / 2, halfD = D / 2;

    function tempToRGB(t, isMist) {
        const clamped = Math.max(20.0, Math.min(30.5, t));
        let r, g, b;
        if (clamped <= 23.0) {
            // Azul gelado -> Ciano frio
            const u = (clamped - 20.0) / 3.0;
            r = 0.06 + 0.08 * u; g = 0.58 + 0.30 * u; b = 1.0;
        } else if (clamped <= 26.2) {
            // Ciano -> Verde esmeralda ideal
            const u = (clamped - 23.0) / 3.2;
            r = 0.14 * (1 - u) + 0.08 * u; g = 0.88 * (1 - u) + 0.85 * u; b = 1.0 * (1 - u) + 0.45 * u;
        } else if (clamped <= 27.8) {
            // Verde -> Amarelo/Âmbar atenção
            const u = (clamped - 26.2) / 1.6;
            r = 0.08 + 0.90 * u; g = 0.85 - 0.15 * u; b = 0.45 * (1 - u) + 0.08 * u;
        } else {
            // Âmbar -> Vermelho calor crítico
            const u = (clamped - 27.8) / 2.7;
            r = 0.98; g = 0.70 - 0.48 * u; b = 0.08 + 0.10 * u;
        }
        if (isMist) {
            // Azul clarinho representando vapor d'água do umidificador
            return [0.52, 0.88, 1.0];
        }
        return [r, g, b];
    }

    function createFluidTexture() {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.42)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    function createTileTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#cbd5e1';
        g.fillRect(0, 0, 256, 256);
        g.strokeStyle = '#94a3b8';
        g.lineWidth = 3;
        for (let i = 0; i <= 256; i += 64) {
            g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
            g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(5, 5);
        return tex;
    }

    function buildRoom() {
        const room = new THREE.Group();
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.88, metalness: 0.05 });
        const floorMat = new THREE.MeshStandardMaterial({ map: createTileTexture(), color: 0xb0bec5, roughness: 0.65, metalness: 0.08 });

        // Piso cerâmico (elevado levemente acima do píer para nunca haver z-fighting)
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.8), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0.3, 0.02, 0.3);
        floor.receiveShadow = true;
        room.add(floor);

        // Parede do fundo
        const backWall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), wallMat);
        backWall.position.set(0.3, 1.8, -2.1);
        backWall.receiveShadow = true;
        room.add(backWall);

        // Parede esquerda (com janela e Split Inverter)
        const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.6), wallMat);
        leftWall.rotation.y = Math.PI / 2;
        leftWall.position.set(-2.6, 1.8, 0.3);
        leftWall.receiveShadow = true;
        room.add(leftWall);

        // Parede direita (fecha o quarto para o modo FPS)
        const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.6), wallMat);
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(3.5, 1.8, 0.3);
        rightWall.receiveShadow = true;
        room.add(rightWall);

        // Rodapés modernos nas paredes
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.55 });
        const baseBack = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.09, 0.025), baseMat);
        baseBack.position.set(0.45, 0.045, -2.09);
        room.add(baseBack);
        const baseLeft = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.09, 4.6), baseMat);
        baseLeft.position.set(-2.59, 0.045, 0.2);
        room.add(baseLeft);
        const baseRight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.09, 4.6), baseMat);
        baseRight.position.set(3.49, 0.045, 0.2);
        room.add(baseRight);

        // Parede frontal com vão da porta + Porta articulada (visíveis no modo FPS ou zoom afastado)
        frontWallGroup = new THREE.Group();
        frontWallGroup.visible = (cam.mode === 'fps');

        const frontWallMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.85, side: THREE.DoubleSide });
        const fwLeft = new THREE.Mesh(new THREE.PlaneGeometry(5.08, 3.6), frontWallMat);
        fwLeft.rotation.y = Math.PI;
        fwLeft.position.set(-0.76, 1.8, 2.45);
        frontWallGroup.add(fwLeft);

        const fwRight = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 3.6), frontWallMat);
        fwRight.rotation.y = Math.PI;
        fwRight.position.set(3.31, 1.8, 2.45);
        frontWallGroup.add(fwRight);

        const fwTop = new THREE.Mesh(new THREE.PlaneGeometry(0.94, 1.42), frontWallMat);
        fwTop.rotation.y = Math.PI;
        fwTop.position.set(2.25, 2.89, 2.45);
        frontWallGroup.add(fwTop);

        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.8), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9, side: THREE.FrontSide }));
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0.3, 3.48, 0.3);
        room.add(ceiling);

        // Batente + Porta articulada com dobradiça em x = 2.70
        const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
        const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.20, 0.12), doorFrameMat);
        frameL.position.set(1.78, 1.10, 2.45);
        frontWallGroup.add(frameL);
        const frameR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.20, 0.12), doorFrameMat);
        frameR.position.set(2.72, 1.10, 2.45);
        frontWallGroup.add(frameR);
        const frameT = new THREE.Mesh(new THREE.BoxGeometry(1.00, 0.08, 0.12), doorFrameMat);
        frameT.position.set(2.25, 2.18, 2.45);
        frontWallGroup.add(frameT);

        roomDoorPivot = new THREE.Group();
        roomDoorPivot.position.set(2.70, 0, 2.45);
        const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.88, 2.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.6 }));
        doorLeaf.position.set(-0.45, 1.07, 0);
        roomDoorPivot.add(doorLeaf);
        const handleMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.85, roughness: 0.25 });
        const doorHandleIn = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), handleMat);
        doorHandleIn.position.set(-0.80, 1.05, -0.045);
        roomDoorPivot.add(doorHandleIn);
        const doorHandleOut = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), handleMat);
        doorHandleOut.position.set(-0.80, 1.05, 0.045);
        roomDoorPivot.add(doorHandleOut);
        tagInteractive(roomDoorPivot, 'porta');
        frontWallGroup.add(roomDoorPivot);
        room.add(frontWallGroup);

        // Luminária no teto do quarto
        const ceilLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0xfef9c3, emissive: 0xfef08a, emissiveIntensity: 0.6 }));
        ceilLamp.position.set(0.35, 3.44, 0.15);
        room.add(ceilLamp);

        // Janela com persiana na parede esquerda
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.5 });
        const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.35, 1.65), frameMat);
        winFrame.position.set(-2.57, 1.55, -0.35);
        room.add(winFrame);

        const glassMat = new THREE.MeshStandardMaterial({ color: 0xbae6fd, emissive: 0x38bdf8, emissiveIntensity: 0.25, roughness: 0.2 });
        const winGlass = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.22, 1.52), glassMat);
        winGlass.position.set(-2.56, 1.55, -0.35);
        room.add(winGlass);

        // Lâminas da persiana
        const blindMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.5 });
        for (let b = 0; b < 9; b++) {
            const slat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 1.48), blindMat);
            slat.position.set(-2.54, 1.02 + b * 0.13, -0.35);
            room.add(slat);
        }

        // Ar-Condicionado Split Inverter ACIMA DA JANELA (pegável e encaixável na parede)
        const acGroup = new THREE.Group();
        acGroup.position.set(-2.42, 2.75, -0.35);
        const acBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, 0.34, 1.18),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.15 })
        );
        acGroup.add(acBody);

        acVanePivot = new THREE.Group();
        acVanePivot.position.set(0.17, -0.14, 0);
        acVaneMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, emissive: 0x38bdf8, emissiveIntensity: 0.05, roughness: 0.3 });
        const acVane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.025, 1.06), acVaneMat);
        acVane.position.set(0.02, -0.015, 0);
        acVanePivot.add(acVane);
        acGroup.add(acVanePivot);

        acLedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const acLed = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.08), acLedMat);
        acLed.position.set(0.18, -0.01, 0.47);
        acGroup.add(acLed);
        room.add(acGroup);
        tagInteractive(acGroup, 'ar');
        registerPickable(acGroup, { halfH: 0.17, holdDist: 1.85, snapToWall: true });

        // Estante preta de apoio à DIREITA da estufa (pegável; se pegar, itens em cima caem no chão!)
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
        const rx = 1.05, rz = -0.55;
        const blackShelfGroup = new THREE.Group();
        blackShelfGroup.position.set(rx, 0, rz);
        [0.12, 0.72, 1.32].forEach(sy => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 0.55), shelfMat);
            p.position.set(0, sy, 0);
            blackShelfGroup.add(p);
        });
        [[-0.44, -0.24], [0.44, -0.24], [-0.44, 0.24], [0.44, 0.24]].forEach(([ox, oz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 8), shelfMat);
            leg.position.set(ox, 0.73, oz);
            blackShelfGroup.add(leg);
        });
        room.add(blackShelfGroup);
        registerPickable(blackShelfGroup, {
            isShelf: true,
            halfH: 0,
            holdDist: 2.15,
            halfW: 0.475,
            halfD: 0.275,
            shelfLevels: [0.14, 0.74, 1.34]
        });

        // Umidificador azul + mangueira amarela juntos (pegáveis em conjunto!)
        const ux = rx - 0.18, uy = 1.52, uz = rz;
        const umidGroup = new THREE.Group();
        umidGroup.position.set(ux, uy, uz);
        const umidBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.19, 0.36, 16),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3, transparent: true, opacity: 0.88 })
        );
        umidGroup.add(umidBase);

        const hoseMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
        const hoseCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0.20, 0),
            new THREE.Vector3(0.03, 0.73, 0.05),
            new THREE.Vector3((GX + halfW + 0.05) - ux, 2.28 - uy, (GZ + 0.15) - uz),
            new THREE.Vector3((GX + halfW - 0.12) - ux, 2.15 - uy, (GZ + 0.15) - uz)
        ]);
        const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.04, 10, false), hoseMat);
        umidGroup.add(hose);
        room.add(umidGroup);
        tagInteractive(umidGroup, 'umid');
        registerPickable(umidGroup, { halfH: 0.18, holdDist: 1.55, supportedBy: blackShelfGroup });

        // Potes de vidro / frascos na estante (pegáveis)
        const jarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, transparent: true, opacity: 0.65 });
        [0.12, 0.30].forEach(ox => {
            const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), jarMat);
            jar.position.set(rx + ox, 1.43, rz + 0.05);
            room.add(jar);
            registerPickable(jar, { halfH: 0.09, holdDist: 1.2, supportedBy: blackShelfGroup });
            const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3 }));
            bottle.position.set(rx + ox - 0.15, 0.85, rz);
            room.add(bottle);
            registerPickable(bottle, { halfH: 0.11, holdDist: 1.2, supportedBy: blackShelfGroup });
        });

        // Controlador ESP32-C3 + Régua de Relés preso na lateral esquerda da estante
        const ctrlGroup = new THREE.Group();
        ctrlGroup.position.set(rx - 0.47, 1.04, rz + 0.24);
        const ctrlBox = new THREE.Mesh(
            new THREE.BoxGeometry(0.06, 0.22, 0.15),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.1 })
        );
        ctrlGroup.add(ctrlBox);
        const ctrlPanel = new THREE.Mesh(
            new THREE.BoxGeometry(0.01, 0.07, 0.11),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.25, emissive: 0x0284c7, emissiveIntensity: 0.25 })
        );
        ctrlPanel.position.set(-0.032, 0.055, 0);
        ctrlGroup.add(ctrlPanel);
        // LED azul/ciano de heartbeat do ESP32 piscando
        espHeartbeatMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const espLed = new THREE.Mesh(new THREE.SphereGeometry(0.011, 8, 8), espHeartbeatMat);
        espLed.position.set(-0.036, 0.082, 0.045);
        ctrlGroup.add(espLed);
        // 5 LEDs indicadores dos relés (Luz, Umid, Vento, Exaust, AC)
        [
            { key: 'luz', z: -0.044 },
            { key: 'umid', z: -0.022 },
            { key: 'vento', z: 0.0 },
            { key: 'exaust', z: 0.022 },
            { key: 'ar', z: 0.044 }
        ].forEach(item => {
            const mat = new THREE.MeshBasicMaterial({ color: 0x334155 });
            relayLedMats[item.key] = mat;
            const led = new THREE.Mesh(new THREE.SphereGeometry(0.0085, 8, 8), mat);
            led.position.set(-0.035, -0.035, item.z);
            ctrlGroup.add(led);
        });
        room.add(ctrlGroup);
        tagInteractive(ctrlGroup, 'esp32');
        registerPickable(ctrlGroup, { halfH: 0.11, holdDist: 1.2, supportedBy: blackShelfGroup });

        // Termômetro digital de parede no quarto (entre a janela/AC e a estufa)
        roomThermDisplay = createThermometerDisplay(0.48, 0.24);
        roomThermDisplay.group.position.set(-1.62, 1.92, -2.07);
        room.add(roomThermDisplay.group);

        // Cabo preto ligando o controlador ESP32 à estufa
        const wireCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(rx - 0.47, 0.94, rz + 0.24),
            new THREE.Vector3(rx - 0.62, 0.72, rz + 0.28),
            new THREE.Vector3(GX + halfW, 0.85, GZ + 0.25)
        ]);
        const wire = new THREE.Mesh(
            new THREE.TubeGeometry(wireCurve, 12, 0.008, 6, false),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
        );
        room.add(wire);

        // Estante aramada de SPAWNS mais à direita (pegável; itens em cima caem se mover!)
        const sx = 2.35, sz = -0.85;
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 });
        const grainMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.75 });
        const subBagMat = new THREE.MeshStandardMaterial({ color: 0xa8a29e, roughness: 0.85 });
        const wireShelfGroup = new THREE.Group();
        wireShelfGroup.position.set(sx, 0, sz);
        [0.2, 0.75, 1.3, 1.85].forEach(sy => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.025, 0.52), chromeMat);
            p.position.set(0, sy, 0);
            wireShelfGroup.add(p);
        });
        [[-0.55, -0.24], [0.55, -0.24], [-0.55, 0.24], [0.55, 0.24]].forEach(([ox, oz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.0, 8), chromeMat);
            leg.position.set(ox, 1.0, oz);
            wireShelfGroup.add(leg);
        });
        room.add(wireShelfGroup);
        registerPickable(wireShelfGroup, {
            isShelf: true,
            halfH: 0,
            holdDist: 2.25,
            halfW: 0.575,
            halfD: 0.26,
            shelfLevels: [0.212, 0.762, 1.312, 1.862]
        });

        [0.2, 0.75, 1.3, 1.85].forEach((sy, idx) => {
            if (idx === 2) {
                // Placas de Petri empilhadas na estante (pegáveis em pilhas)
                [0x86efac, 0xfef08a, 0xbae6fd, 0xe2e8f0].forEach((col, pIdx) => {
                    const petriStack = new THREE.Group();
                    petriStack.position.set(sx - 0.35 + pIdx * 0.14, sy + 0.012, sz + 0.08);
                    const dishMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.2, transparent: true, opacity: 0.82 });
                    for (let st = 0; st < 4; st++) {
                        const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.014, 14), dishMat);
                        dish.position.y = 0.008 + st * 0.015;
                        petriStack.add(dish);
                    }
                    room.add(petriStack);
                    registerPickable(petriStack, { halfH: 0, holdDist: 1.15, supportedBy: wireShelfGroup });
                });
                for (let k = 1; k <= 2; k++) {
                    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.24), grainMat);
                    bag.position.set(sx + k * 0.21, sy + 0.142, sz - 0.06);
                    room.add(bag);
                    registerPickable(bag, { halfH: 0.13, holdDist: 1.3, supportedBy: wireShelfGroup });
                }
            } else {
                const matSaco = idx >= 2 ? grainMat : subBagMat;
                for (let k = -2; k <= 2; k++) {
                    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.24), matSaco);
                    bag.position.set(sx + k * 0.21, sy + 0.142, sz);
                    room.add(bag);
                    registerPickable(bag, { halfH: 0.13, holdDist: 1.3, supportedBy: wireShelfGroup });
                }
            }
        });

        // Caixa organizadora translúcida no chão ao lado da estante de spawns (pegável)
        const tub = new THREE.Mesh(
            new THREE.BoxGeometry(0.46, 0.26, 0.34),
            new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.35, transparent: true, opacity: 0.55 })
        );
        tub.position.set(sx - 0.82, 0.13, sz + 0.34);
        room.add(tub);
        registerPickable(tub, { halfH: 0.13, holdDist: 1.45 });

        room.traverse(obj => {
            if (obj.isMesh && obj !== floor && obj !== backWall && obj !== leftWall && obj !== rightWall && obj !== ceiling && obj !== fwLeft && obj !== fwRight && obj !== fwTop) {
                obj.castShadow = true;
                obj.receiveShadow = true;
            }
        });

        return room;
    }

    function createMylarTexture() {
        const c = document.createElement('canvas');
        c.width = 128; c.height = 128;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#d8dee9';
        ctx.fillRect(0, 0, 128, 128);
        for (let y = 0; y < 128; y += 8) {
            for (let x = 0; x < 128; x += 8) {
                const v = 188 + Math.floor(Math.sin(x * 0.7 + y * 0.5) * 28 + Math.cos(x * 0.4 - y * 0.8) * 20);
                ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
                ctx.fillRect(x, y, 7, 7);
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 6);
        return tex;
    }

    function createThermometerDisplay(w, h) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        const grp = new THREE.Group();

        const caseMesh = new THREE.Mesh(
            new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.024),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.35 })
        );
        grp.add(caseMesh);

        const screenMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(w, h),
            new THREE.MeshBasicMaterial({ map: tex })
        );
        screenMesh.position.z = 0.013;
        grp.add(screenMesh);

        let lastKey = '';
        function update(titulo, temp, subText) {
            const key = `${titulo}|${temp.toFixed(1)}|${subText}`;
            if (key === lastKey) return;
            lastKey = key;

            let cor = '#34d399';
            let statusTxt = 'IDEAL';
            if (temp <= 23.0) { cor = '#38bdf8'; statusTxt = 'FRIO'; }
            else if (temp <= 26.8) { cor = '#34d399'; statusTxt = 'IDEAL'; }
            else if (temp <= 28.2) { cor = '#facc15'; statusTxt = 'ATENÇÃO'; }
            else { cor = '#fb7185'; statusTxt = 'CRÍTICO'; }

            ctx.fillStyle = '#090f1d';
            ctx.fillRect(0, 0, 256, 128);
            ctx.strokeStyle = cor;
            ctx.lineWidth = 5;
            ctx.strokeRect(4, 4, 248, 120);

            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 20px sans-serif';
            ctx.fillText(titulo, 16, 30);

            ctx.fillStyle = cor;
            ctx.font = 'bold 17px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(statusTxt, 240, 30);
            ctx.textAlign = 'left';

            ctx.fillStyle = cor;
            ctx.font = 'bold 52px monospace';
            ctx.fillText(`${temp.toFixed(1)}°C`, 16, 88);

            ctx.fillStyle = '#cbd5e1';
            ctx.font = 'bold 18px sans-serif';
            ctx.fillText(subText, 16, 114);

            tex.needsUpdate = true;
        }
        return { group: grp, update };
    }

    function buildTent() {
        const group = new THREE.Group();
        group.position.set(GX, 0, GZ);

        const blackMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.82, metalness: 0.1 });
        const mylarTex = createMylarTexture();
        const mylarMat = new THREE.MeshStandardMaterial({
            color: 0xf1f5f9,
            map: mylarTex,
            bumpMap: mylarTex,
            bumpScale: 0.015,
            roughness: 0.22,
            metalness: 0.88,
            emissive: 0xfef3c7,
            emissiveIntensity: 0.0,
            side: THREE.FrontSide
        });
        mylarMatRef = mylarMat;
        const greenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.35, metalness: 0.3, emissive: 0x052e16, emissiveIntensity: 0.25 });

        function addWall(w, h, x, y, z, rx, ry) {
            const inner = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mylarMat);
            inner.position.set(x, y, z);
            inner.rotation.set(rx, ry, 0);
            group.add(inner);

            const outer = new THREE.Mesh(new THREE.PlaneGeometry(w, h), blackMat);
            outer.position.set(x, y, z);
            outer.rotation.set(rx, ry + Math.PI, 0);
            if (rx !== 0) {
                outer.rotation.set(-rx, 0, 0);
                outer.position.y += (y > H / 2 ? 0.01 : -0.01);
            } else {
                outer.position.x += (x === 0 ? 0 : (x > 0 ? 0.01 : -0.01));
                outer.position.z += (z < 0 ? -0.01 : 0);
            }
            group.add(outer);
        }

        addWall(W, H, 0, H / 2, -halfD, 0, 0);
        addWall(D, H, -halfW, H / 2, 0, 0, Math.PI / 2);
        addWall(D, H, halfW, H / 2, 0, 0, -Math.PI / 2);
        addWall(W, D, 0, H, 0, Math.PI / 2, 0);
        addWall(W, D, 0, 0.01, 0, -Math.PI / 2, 0);

        const poleR = 0.028;
        function addPole(x1, y1, z1, x2, y2, z2) {
            const p1 = new THREE.Vector3(x1, y1, z1);
            const p2 = new THREE.Vector3(x2, y2, z2);
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, p1.distanceTo(p2), 10), greenMat);
            cyl.position.copy(p1).add(p2).multiplyScalar(0.5);
            cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
            group.add(cyl);
        }
        const corners = [
            [-halfW, 0, -halfD], [halfW, 0, -halfD], [halfW, 0, halfD], [-halfW, 0, halfD],
            [-halfW, H, -halfD], [halfW, H, -halfD], [halfW, H, halfD], [-halfW, H, halfD]
        ];
        for (let i = 0; i < 4; i++) {
            const n = (i + 1) % 4;
            addPole(...corners[i], ...corners[n]);
            addPole(...corners[i + 4], ...corners[n + 4]);
            addPole(...corners[i], ...corners[i + 4]);
        }

        // Aba enrolada no topo da porta
        const roll = new THREE.Mesh(
            new THREE.CylinderGeometry(0.10, 0.10, W * 0.92, 16),
            new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45, metalness: 0.5 })
        );
        roll.rotation.z = Math.PI / 2;
        roll.position.set(0, H - 0.10, halfD + 0.05);
        group.add(roll);

        // Duto sanfonado prateado INFERIOR ESQUERDO encostado no chão (por onde o ar SAI para o quarto!)
        const ductMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.28, metalness: 0.82 });
        const ductCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-halfW + 0.04, 0.19, 0.35),
            new THREE.Vector3(-halfW - 0.18, 0.14, 0.40),
            new THREE.Vector3(-halfW - 0.38, 0.10, 0.48),
            new THREE.Vector3(-halfW - 0.56, 0.10, 0.56)
        ]);
        const ductOut = new THREE.Mesh(new THREE.TubeGeometry(ductCurve, 20, 0.095, 14, false), ductMat);
        group.add(ductOut);
        // Anéis metálicos dando efeito sanfonado real
        for (let t = 0.08; t <= 0.96; t += 0.085) {
            const pt = ductCurve.getPoint(t);
            const tan = ductCurve.getTangent(t);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.102, 0.012, 8, 16), ductMat);
            ring.position.copy(pt);
            ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.normalize());
            group.add(ring);
        }

        // 2 estantes pretas internas com bolos marrons em bandejas e cogumelos crescendo em flush!
        const rackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
        const trayMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.75, roughness: 0.3 });
        trayMatRef = trayMat;
        const subMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.9 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.55 });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 });

        // Prateleiras internas da estufa (registrada depois no tentGroup inteiro)
        tentGroup = group;

        [-0.34, 0.34].forEach((rx, rIdx) => {
            [0.35, 0.92, 1.48].forEach((sy, sIdx) => {
                const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.025, 0.78), rackMat);
                shelf.position.set(rx, sy, -0.08);
                group.add(shelf);

                // Bolo + bandeja + 9 cogumelos agrupados e pegáveis (em coordenadas do mundo para poder sair da estufa!)
                const cakeGroup = new THREE.Group();
                cakeGroup.position.set(GX + rx, sy + 0.012, GZ - 0.08);

                const tray = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.59), trayMat);
                tray.position.set(0, 0.02, 0);
                cakeGroup.add(tray);
                const block = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.56), subMat);
                block.position.set(0, 0.083, 0);
                cakeGroup.add(block);

                // 9 cogumelos por bolo nascendo e crescendo em tempos variados
                for (let m = 0; m < 9; m++) {
                    const row = Math.floor(m / 3) - 1;
                    const col = (m % 3) - 1;
                    const mx = col * 0.11 + (Math.random() - 0.5) * 0.04;
                    const mz = row * 0.15 + (Math.random() - 0.5) * 0.04;

                    const mushGroup = new THREE.Group();
                    mushGroup.position.set(mx, 0.153, mz);
                    mushGroup.rotation.z = (Math.random() - 0.5) * 0.18;
                    mushGroup.rotation.x = (Math.random() - 0.5) * 0.18;

                    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.016, 0.09, 8), stemMat);
                    stem.position.y = 0.045;
                    mushGroup.add(stem);

                    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
                    cap.position.y = 0.085;
                    mushGroup.add(cap);

                    cakeGroup.add(mushGroup);
                    mushrooms.push({
                        mesh: mushGroup,
                        delay: (rIdx * 0.04 + sIdx * 0.05 + m * 0.025) % 0.25,
                        maxScale: 0.75 + Math.random() * 0.55
                    });
                }

                scene.add(cakeGroup);
                tagInteractive(cakeGroup, 'cogumelos');
                registerPickable(cakeGroup, { halfH: 0, holdDist: 1.35, supportedBy: tentGroup });
            });
        });

        // Barra LED no teto
        ledBarMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0xfef08a, emissiveIntensity: 0.05 });
        const ledBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.04, 0.14), ledBarMat);
        ledBar.position.set(-0.15, H - 0.12, -0.1);
        group.add(ledBar);
        tagInteractive(ledBar, 'luz');

        ledLight = new THREE.PointLight(0xfef9c3, 0, 4.5, 1.5);
        ledLight.position.set(-0.15, H - 0.22, -0.1);
        group.add(ledLight);

        ledConeMat = new THREE.MeshBasicMaterial({
            color: 0xfef9c3,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ledCone = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.68, 1.35, 18, 1, true), ledConeMat);
        ledCone.position.set(-0.15, H - 0.82, -0.1);
        group.add(ledCone);

        // Mini sensor digital na lateral interna da estufa
        tentThermDisplay = createThermometerDisplay(0.30, 0.16);
        tentThermDisplay.group.position.set(halfW - 0.04, 1.32, 0.28);
        tentThermDisplay.group.rotation.y = -Math.PI / 2.6;
        group.add(tentThermDisplay.group);

        // Ventilador Interno (canto superior direito)
        const fanHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 16), rackMat);
        fanHousing.rotation.z = Math.PI / 2;
        fanHousing.position.set(halfW - 0.15, 1.92, 0.1);
        group.add(fanHousing);

        ventoHelice = new THREE.Group();
        ventoHelice.position.set(halfW - 0.19, 1.92, 0.1);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.3 });
        for (let b = 0; b < 3; b++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.20, 0.045), bladeMat);
            blade.rotation.x = (b * Math.PI) / 3;
            ventoHelice.add(blade);
        }
        group.add(ventoHelice);
        tagInteractive(fanHousing, 'vento');
        tagInteractive(ventoHelice, 'vento');

        // Exaustor no TOPO (empurra ar do quarto PARA DENTRO da estufa de cima pra baixo!)
        const exaustTube = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 18), ductMat);
        exaustTube.position.set(0.05, H + 0.02, -0.2);
        group.add(exaustTube);

        exaustHelice = new THREE.Group();
        exaustHelice.position.set(0.05, H - 0.06, -0.2);
        const exBladeMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35 });
        for (let b = 0; b < 4; b++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.05), exBladeMat);
            blade.rotation.y = (b * Math.PI) / 4;
            exaustHelice.add(blade);
        }
        group.add(exaustHelice);
        tagInteractive(exaustTube, 'exaust');
        tagInteractive(exaustHelice, 'exaust');
        registerPickable(group, {
            isShelf: true,
            halfH: 0,
            holdDist: 2.45,
            halfW: 0.68,
            halfD: 0.56,
            shelfLevels: [0.362, 0.932, 1.492]
        });

        return group;
    }

    function assignTentHome(p) {
        p.homeX = GX + (Math.random() - 0.5) * (W * 0.85);
        p.homeY = 0.15 + Math.random() * (H - 0.30);
        p.homeZ = GZ + (Math.random() - 0.5) * (D * 0.82);
    }

    function assignRoomHome(p) {
        let rx = -2.38 + Math.random() * 5.65;
        let ry = 0.22 + Math.random() * 3.00;
        let rz = -1.88 + Math.random() * 3.95;
        if (rx > GX - halfW - 0.10 && rx < GX + halfW + 0.10 && rz > GZ - halfD - 0.10 && rz < GZ + halfD + 0.10 && ry < H + 0.08) {
            rx = (rx < GX) ? (GX - halfW - 0.28) : (GX + halfW + 0.28);
        }
        p.homeX = rx; p.homeY = ry; p.homeZ = rz;
    }

    function buildFluids(tex) {
        const aGeo = new THREE.BufferGeometry();
        airPos = new Float32Array(AIR_COUNT * 3);
        airCol = new Float32Array(AIR_COUNT * 3);

        // 1. Partículas iniciais dentro da estufa (TENT_SEED)
        for (let i = 0; i < TENT_SEED; i++) {
            const p = {
                inTent: true,
                homeX: 0, homeY: 0, homeZ: 0,
                x: 0, y: 0, z: 0,
                vx: 0, vy: 0, vz: 0,
                temp: state.tempInt,
                mist: false
            };
            assignTentHome(p);
            p.x = p.homeX; p.y = p.homeY; p.z = p.homeZ;
            airParticles.push(p);
            airPos[i * 3] = p.x; airPos[i * 3 + 1] = p.y; airPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, false);
            airCol[i * 3] = r; airCol[i * 3 + 1] = g; airCol[i * 3 + 2] = b;
        }

        // 2. Partículas iniciais homogêneas no quarto (620 em grade estratificada 3D)
        const roomRem = AIR_COUNT - TENT_SEED;
        const nx = 10, ny = 8, nz = 8;
        let idx = TENT_SEED;
        for (let ix = 0; ix < nx && idx < AIR_COUNT; ix++) {
            for (let iy = 0; iy < ny && idx < AIR_COUNT; iy++) {
                for (let iz = 0; iz < nz && idx < AIR_COUNT; iz++) {
                    let rx = -2.38 + ((ix + 0.5) / nx) * 5.65 + (Math.random() - 0.5) * 0.28;
                    let ry = 0.22 + ((iy + 0.5) / ny) * 3.00 + (Math.random() - 0.5) * 0.20;
                    let rz = -1.88 + ((iz + 0.5) / nz) * 3.95 + (Math.random() - 0.5) * 0.28;
                    if (rx > GX - halfW - 0.10 && rx < GX + halfW + 0.10 && rz > GZ - halfD - 0.10 && rz < GZ + halfD + 0.10 && ry < H + 0.08) {
                        rx = (rx < GX) ? (GX - halfW - 0.26) : (GX + halfW + 0.26);
                    }
                    const p = {
                        inTent: false,
                        homeX: rx, homeY: ry, homeZ: rz,
                        x: rx, y: ry, z: rz,
                        vx: 0, vy: 0, vz: 0,
                        temp: state.tempExt,
                        mist: false
                    };
                    airParticles.push(p);
                    airPos[idx * 3] = p.x; airPos[idx * 3 + 1] = p.y; airPos[idx * 3 + 2] = p.z;
                    const [r, g, b] = tempToRGB(p.temp, false);
                    airCol[idx * 3] = r; airCol[idx * 3 + 1] = g; airCol[idx * 3 + 2] = b;
                    idx++;
                }
            }
        }
        while (airParticles.length < AIR_COUNT) {
            const p = { inTent: false, homeX: 0, homeY: 1, homeZ: 0, x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, temp: state.tempExt, mist: false };
            assignRoomHome(p);
            p.x = p.homeX; p.y = p.homeY; p.z = p.homeZ;
            const k = airParticles.length;
            airParticles.push(p);
            airPos[k * 3] = p.x; airPos[k * 3 + 1] = p.y; airPos[k * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, false);
            airCol[k * 3] = r; airCol[k * 3 + 1] = g; airCol[k * 3 + 2] = b;
        }

        aGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
        aGeo.setAttribute('color', new THREE.BufferAttribute(airCol, 3));
        airPoints = new THREE.Points(aGeo, new THREE.PointsMaterial({
            size: 0.11,
            map: tex,
            vertexColors: true,
            transparent: true,
            opacity: 0.46,
            depthWrite: false
        }));
        scene.add(airPoints);

        // Linhas de fluxo CFD unificadas (aparecem apenas onde há corrente real de ar)
        const lGeo = new THREE.BufferGeometry();
        airLinePos = new Float32Array(AIR_COUNT * 6);
        airLineCol = new Float32Array(AIR_COUNT * 6);
        lGeo.setAttribute('position', new THREE.BufferAttribute(airLinePos, 3));
        lGeo.setAttribute('color', new THREE.BufferAttribute(airLineCol, 3));
        airLines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.65
        }));
        scene.add(airLines);

        // Emissor dedicado de vapor azul-clarinho na boca da mangueira amarela
        const mGeo = new THREE.BufferGeometry();
        mistPos = new Float32Array(MIST_COUNT * 3);
        for (let i = 0; i < MIST_COUNT; i++) {
            mistParticles.push({
                x: GX + halfW - 0.12,
                y: 2.12 - (i / MIST_COUNT) * 0.85,
                z: GZ + 0.15,
                vx: -(0.002 + Math.random() * 0.002),
                vy: -(0.004 + Math.random() * 0.003),
                vz: (Math.random() - 0.5) * 0.002,
                life: (i / MIST_COUNT)
            });
            mistPos[i * 3] = mistParticles[i].x;
            mistPos[i * 3 + 1] = mistParticles[i].y;
            mistPos[i * 3 + 2] = mistParticles[i].z;
        }
        mGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
        mistPoints = new THREE.Points(mGeo, new THREE.PointsMaterial({
            size: 0.24,
            color: 0x7dd3fc,
            map: tex,
            transparent: true,
            opacity: 0.0,
            depthWrite: false
        }));
        scene.add(mistPoints);
    }

    function stepFluidPhysics() {
        simTime += 0.025;
        const topHeatBonus = state.luz ? 1.1 : 0.0;
        const humMistRatio = state.humInt <= 93.0 ? 0.0 : Math.min(0.48, Math.pow((state.humInt - 93.0) / 7.0, 1.8) * 0.48);

        const tentAirflow = state.vento || state.exaust;
        const tentCurl = tentAirflow ? 0.00050 : (state.umid ? 0.00025 : 0.00009);
        const tentTime = tentAirflow ? simTime : (state.umid ? simTime * 0.5 : simTime * 0.25);
        const tentDamp = tentAirflow ? 0.95 : (state.umid ? 0.94 : 0.90);

        const roomActive = state.ar || state.exaust;
        const roomCurl = roomActive ? 0.00050 : 0.00009;
        const roomTime = roomActive ? simTime : simTime * 0.25;
        const roomDamp = roomActive ? 0.955 : 0.90;

        const acColdTemp = Math.min(18.5, state.tempExt - 6.0);
        const topExX = GX + 0.05, topExY = H + 0.14, topExZ = GZ - 0.20;
        const ductInX = GX - halfW + 0.04, ductInY = 0.19, ductInZ = GZ + 0.35;
        const ductOutX = GX - halfW - 0.56, ductOutY = 0.10, ductOutZ = GZ + 0.56;
        const minTX = GX - halfW - 0.06, maxTX = GX + halfW + 0.06;
        const minTZ = GZ - halfD - 0.06, maxTZ = GZ + halfD + 0.06;

        let tentIdx = 0;

        for (let i = 0; i < AIR_COUNT; i++) {
            const p = airParticles[i];
            let showVapor = false;

            if (p.inTent) {
                tentIdx++;
                const lx = p.x - GX;
                const lz = p.z - GZ;

                // Ar suspenso em repouso; corrente suave quando umidificador/exaustor/vento ligam
                p.vx += Math.sin(p.y * 2.5 + tentTime) * Math.cos(lz * 2.3 + tentTime * 0.7) * tentCurl;
                p.vy += Math.sin(lx * 2.4 + tentTime * 0.8) * (tentCurl * 0.7);
                p.vz += Math.cos(p.y * 2.3 - tentTime) * Math.sin(lx * 2.5 + tentTime * 0.6) * tentCurl;
                p.vx += (p.homeX - p.x) * (tentAirflow ? 0.00008 : 0.00014);
                p.vy += (p.homeY - p.y) * (tentAirflow ? 0.00008 : 0.00014);
                p.vz += (p.homeZ - p.z) * (tentAirflow ? 0.00008 : 0.00014);
                p.vy += (p.temp - state.tempInt) * (tentAirflow ? 0.00015 : 0.00006);

                if (state.vento) {
                    const dist = Math.hypot(lx, lz) + 0.06;
                    p.vx += (-lz / dist) * 0.0024;
                    p.vz += (lx / dist) * 0.0024;
                }

                // Exaustor ligado: empurra ar de cima para baixo e puxa para o duto inferior esquerdo
                if (state.exaust) {
                    p.vy -= 0.0018;
                    if (p.y < 0.78) {
                        const dx = ductInX - p.x;
                        const dy = ductInY - p.y;
                        const dz = ductInZ - p.z;
                        const dDuct = Math.hypot(dx, dy, dz) + 0.05;
                        p.vx += (dx / dDuct) * 0.0038;
                        p.vy += (dy / dDuct) * 0.0030;
                        p.vz += (dz / dDuct) * 0.0038;
                        // Sai fisicamente pela boca aberta do duto sanfonado seguindo o ângulo exato do tubo!
                        if (dDuct < 0.28) {
                            const spd = 0.018 + Math.random() * 0.006;
                            p.inTent = false;
                            p.mist = false;
                            p.x = ductOutX + (Math.random() - 0.5) * 0.04;
                            p.y = ductOutY + (Math.random() - 0.5) * 0.04;
                            p.z = ductOutZ + (Math.random() - 0.5) * 0.04;
                            p.vx = -0.914 * spd;
                            p.vy = 0.002 + Math.random() * 0.002;
                            p.vz = 0.406 * spd + (Math.random() - 0.5) * 0.003;
                            assignRoomHome(p);
                        }
                    }
                }

                // Se ainda está na estufa, mantém colisão interna e difusão térmica da estufa (sem teleporte!)
                if (p.inTent) {
                    p.vx *= tentDamp; p.vy *= tentDamp; p.vz *= tentDamp;
                    p.x += p.vx; p.y += p.vy; p.z += p.vz;

                    const localGoal = state.tempInt + (p.y > 1.8 ? topHeatBonus : 0);
                    p.temp += (localGoal - p.temp) * 0.032;

                    if (p.x < GX - halfW + 0.06) { p.x = GX - halfW + 0.06; p.vx *= -0.6; }
                    if (p.x > GX + halfW - 0.06) { p.x = GX + halfW - 0.06; p.vx *= -0.6; }
                    if (p.z < GZ - halfD + 0.06) { p.z = GZ - halfD + 0.06; p.vz *= -0.6; }
                    if (p.z > GZ + halfD - 0.06) { p.z = GZ + halfD - 0.06; p.vz *= -0.6; }
                    if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.45; }
                    if (p.y > H - 0.08) { p.y = H - 0.08; p.vy *= -0.45; }

                    showVapor = (((tentIdx % 100) / 100) < humMistRatio) || (p.mist && state.umid);
                }
            } else {
                // PARTÍCULA NO QUARTO (pode entrar na estufa pelo exaustor superior!)
                p.vx += Math.sin(p.y * 1.4 + roomTime * 0.9) * Math.cos(p.z * 1.2 + roomTime * 0.6) * roomCurl;
                p.vy += Math.sin(p.x * 1.1 + roomTime * 0.7) * Math.cos(p.z * 1.1 + roomTime * 0.5) * (roomCurl * 0.75);
                p.vz += Math.cos(p.y * 1.3 - roomTime * 0.8) * Math.sin(p.x * 1.2 + roomTime * 0.5) * roomCurl;
                p.vx += (p.homeX - p.x) * (roomActive ? 0.00030 : 0.00014);
                p.vy += (p.homeY - p.y) * (roomActive ? 0.00055 : 0.00018);
                p.vz += (p.homeZ - p.z) * (roomActive ? 0.00030 : 0.00014);

                const refTempY = (state.ar ? state.tempExt - 2.6 : state.tempExt) + (p.y / 3.4 - 0.5) * 0.35;
                p.vy += (p.temp - refTempY) * (roomActive ? 0.00004 : 0.00003);

                if (p.x < -2.0 && p.y > 0.8 && p.y < 2.3 && Math.abs(p.z + 0.35) < 0.9) {
                    p.temp += ((state.tempExt + 1.2) - p.temp) * 0.015;
                }

                // Ar-Condicionado Split Inverter (suga a partícula do quarto pela grade superior, resfria na serpentina e sopra pela aleta)
                if (state.ar) {
                    const jetCenterY = 2.56 - Math.max(0, p.x + 2.20) * 0.30;
                    if (p.x > -2.30 && p.x < 1.8 && Math.abs(p.y - jetCenterY) < 0.65 && Math.abs(p.z + 0.35) < 1.15) {
                        const distJet = Math.max(0.2, p.x + 2.30);
                        const force = 0.0052 / (0.65 + distJet * 0.65);
                        p.vx += force;
                        p.vy -= force * 0.22;
                        p.vz += Math.sin(p.x * 1.3 + simTime) * 0.0006;
                        if (p.x < -1.8) p.temp += (acColdTemp - p.temp) * 0.14;
                    }
                    p.vx += (p.y > 1.65 ? 0.00045 : -0.00035);
                    if (p.y < 0.65) p.vy += 0.00038;
                    const rx = -2.36 - p.x;
                    const ry = 2.94 - p.y;
                    const rz = -0.35 - p.z;
                    const dRet = Math.hypot(rx, ry, rz) + 0.2;
                    if (dRet < 2.8 && p.y > 2.0) {
                        const pull = 0.0044 / (0.5 + dRet);
                        p.vx += (rx / dRet) * pull;
                        p.vy += (ry / dRet) * pull;
                        p.vz += (rz / dRet) * pull;
                    }
                    // Passando dentro do corpo do split: resfria continuamente e desce para sair pela aleta inferior
                    if (p.x < -2.14 && p.y >= 2.52 && p.y <= 3.05 && Math.abs(p.z + 0.35) < 0.62) {
                        p.temp += (acColdTemp - p.temp) * 0.38;
                        if (p.y > 2.60) {
                            p.vx += 0.003;
                            p.vy -= 0.012;
                        } else {
                            p.vx = Math.max(p.vx, 0.022 + Math.random() * 0.006);
                            p.vy = -(0.004 + Math.random() * 0.002);
                        }
                    }
                }

                // Sucção no topo da estufa: puxa o ar do quarto PARA DENTRO da estufa!
                if (state.exaust) {
                    const sx = topExX - p.x;
                    const sy = topExY - p.y;
                    const sz = topExZ - p.z;
                    const dTop = Math.hypot(sx, sy, sz) + 0.12;
                    if (dTop < 1.95 && p.y > 1.85) {
                        const pull = 0.0058 / (0.35 + dTop);
                        p.vx += (sx / dTop) * pull;
                        p.vy += (sy / dTop) * pull;
                        p.vz += (sz / dTop) * pull;
                    }
                    // Entra fisicamente pela boca do exaustor no topo levando sua temperatura real do quarto!
                    if (dTop < 0.34) {
                        p.inTent = true;
                        p.mist = false;
                        p.x = GX + 0.05 + (Math.random() - 0.5) * 0.18;
                        p.y = H - 0.10;
                        p.z = GZ - 0.20 + (Math.random() - 0.5) * 0.18;
                        p.vx = (Math.random() - 0.5) * 0.008;
                        p.vy = -(0.020 + Math.random() * 0.008);
                        p.vz = (Math.random() - 0.5) * 0.008;
                        assignTentHome(p);
                    }
                }

                if (!p.inTent) {
                    const goalRoom = state.tempExt + (p.y / 3.4 - 0.5) * 0.5;
                    p.temp += (goalRoom - p.temp) * (state.ar ? 0.006 : 0.024);

                    p.vx *= roomDamp; p.vy *= roomDamp; p.vz *= roomDamp;
                    p.x += p.vx; p.y += p.vy; p.z += p.vz;

                    if (p.x < -2.52) { p.x = -2.52; p.vx *= -0.55; }
                    if (p.x > 3.40) { p.x = 3.40; p.vx *= -0.55; }
                    if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.45; }
                    if (p.y > 3.35) { p.y = 3.35; p.vy *= -0.45; }
                    if (p.z < -2.02) { p.z = -2.02; p.vz *= -0.55; }
                    if (p.z > 2.20) { p.z = 2.20; p.vz *= -0.55; }

                    // Deflexão ao redor do volume sólido da Estufa
                    if (p.x > minTX && p.x < maxTX && p.z > minTZ && p.z < maxTZ && p.y < H + 0.04) {
                        const dxL = Math.abs(p.x - minTX), dxR = Math.abs(maxTX - p.x);
                        const dzB = Math.abs(p.z - minTZ), dzF = Math.abs(maxTZ - p.z);
                        const dyT = Math.abs(H + 0.04 - p.y);
                        const m = Math.min(dxL, dxR, dzB, dzF, dyT);
                        if (m === dxL) { p.x = minTX; p.vx = -Math.abs(p.vx) * 0.6; }
                        else if (m === dxR) { p.x = maxTX; p.vx = Math.abs(p.vx) * 0.6; }
                        else if (m === dzB) { p.z = minTZ; p.vz = -Math.abs(p.vz) * 0.6; }
                        else if (m === dzF) { p.z = maxTZ; p.vz = Math.abs(p.vz) * 0.6; }
                        else { p.y = H + 0.04; p.vy = Math.abs(p.vy) * 0.5; }
                    }
                }
            }

            airPos[i * 3] = p.x; airPos[i * 3 + 1] = p.y; airPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, showVapor);
            airCol[i * 3] = r; airCol[i * 3 + 1] = g; airCol[i * 3 + 2] = b;

            const speed = Math.hypot(p.vx, p.vy, p.vz);
            const tail = speed > 0.0035 ? 5.2 : 0.0;
            airLinePos[i * 6] = p.x;
            airLinePos[i * 6 + 1] = p.y;
            airLinePos[i * 6 + 2] = p.z;
            airLinePos[i * 6 + 3] = p.x - p.vx * tail;
            airLinePos[i * 6 + 4] = p.y - p.vy * tail;
            airLinePos[i * 6 + 5] = p.z - p.vz * tail;
            airLineCol[i * 6] = r; airLineCol[i * 6 + 1] = g; airLineCol[i * 6 + 2] = b;
            airLineCol[i * 6 + 3] = r * 0.5; airLineCol[i * 6 + 4] = g * 0.5; airLineCol[i * 6 + 5] = b * 0.5;
        }
        airPoints.geometry.attributes.position.needsUpdate = true;
        airPoints.geometry.attributes.color.needsUpdate = true;
        airLines.geometry.attributes.position.needsUpdate = true;
        airLines.geometry.attributes.color.needsUpdate = true;

        if (mistPoints) {
            mistPoints.material.opacity += ((state.umid ? 0.78 : 0.0) - mistPoints.material.opacity) * 0.08;
            if (mistPoints.material.opacity > 0.01) {
                for (let i = 0; i < MIST_COUNT; i++) {
                    const m = mistParticles[i];
                    m.life += 0.008;
                    m.x += m.vx + Math.sin(simTime + i) * 0.0004;
                    m.y += m.vy;
                    m.z += m.vz + Math.cos(simTime + i) * 0.0004;
                    if (m.life >= 1.0 || m.y < 0.95) {
                        m.x = GX + halfW - 0.12;
                        m.y = 2.12;
                        m.z = GZ + 0.15;
                        m.vx = -(0.002 + Math.random() * 0.0025);
                        m.vy = -(0.0035 + Math.random() * 0.003);
                        m.vz = (Math.random() - 0.5) * 0.002;
                        m.life = 0;
                    }
                    mistPos[i * 3] = m.x; mistPos[i * 3 + 1] = m.y; mistPos[i * 3 + 2] = m.z;
                }
                mistPoints.geometry.attributes.position.needsUpdate = true;
            }
        }
    }

    function terrainHeight(x, z) {
        const r = Math.hypot(x, z);
        // Península da casa da lagoa (terra firme à direita e atrás da casa, conectada ao deck)
        const penDist = Math.hypot((x - 14) / 22, (z + 4) / 18);
        let h = -2.2;
        if (penDist < 1.35) {
            h = Math.max(h, (1.15 - penDist) * 2.2 - 0.12);
        }
        // Margem norte/leste/oeste formando a bacia da lagoa (~1km x 1km)
        const shoreWave = Math.sin(x * 0.025) * 14 + Math.cos(z * 0.022) * 14;
        const basinDist = Math.hypot(x * 0.92, (z - 22) * 1.05) + shoreWave;
        if (basinDist > 52) {
            const t = Math.min(1, (basinDist - 52) / 140);
            h = Math.max(h, -0.35 + t * t * 14.0);
        }
        // Montanhas alpinas imponentes ao fundo (como na foto da lagoa)
        if (r > 165) {
            const mt = Math.min(1, (r - 165) / 250);
            const ridge = Math.abs(Math.sin(x * 0.014 + z * 0.008)) * 0.65
                + Math.abs(Math.cos(z * 0.016 - x * 0.009)) * 0.45
                + Math.sin(r * 0.028) * 0.25;
            h = Math.max(h, mt * mt * (45 + ridge * 92));
        }
        // Escava uma área ampla (> 2 células de 7.7m da malha) sob a fundação da casa/píer para nenhum triângulo invadir o piso ou deck
        if (x > -11.5 && x < 12.0 && z > -10.5 && z < 13.0) {
            return -0.85;
        }
        // Transição suave na ponta da ponte para a península
        if (x >= 12.0 && x < 18.0 && z > -8.0 && z < 11.0) {
            h = Math.min(h, 0.02);
        }
        return h;
    }

    function getGroundHeight(x, z) {
        // Piso da sala do grow e deck de madeira sobre o píer de pedra
        if (x >= -4.4 && x <= 5.0 && z >= -2.3 && z <= 5.5) return 0.02;
        // Ponte de madeira saindo do deck até a terra firme da península (x = 4.8..12.8)
        if (x >= 4.8 && x <= 12.8 && z >= 2.2 && z <= 5.4) {
            const t = (x - 4.8) / 8.0;
            return (1 - t) * 0.02 + t * Math.max(-0.04, terrainHeight(x, z));
        }
        return terrainHeight(x, z);
    }

    function createLogTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        const logs = 8;
        const lh = 256 / logs;
        for (let i = 0; i < logs; i++) {
            const y = i * lh;
            const grad = g.createLinearGradient(0, y, 0, y + lh);
            grad.addColorStop(0.0, '#3e2212');
            grad.addColorStop(0.18, '#7a4626');
            grad.addColorStop(0.55, '#8b522e');
            grad.addColorStop(0.88, '#5a321a');
            grad.addColorStop(1.0, '#2a160b');
            g.fillStyle = grad;
            g.fillRect(0, y, 256, lh);
            for (let k = 0; k < 22; k++) {
                g.fillStyle = k % 2 === 0 ? 'rgba(40,20,10,0.16)' : 'rgba(210,150,95,0.10)';
                g.fillRect((k * 37) % 256, y + 4 + ((k * 13) % (lh - 8)), 28 + (k % 24), 2);
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 2);
        return tex;
    }

    function createShingleTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#334155';
        g.fillRect(0, 0, 256, 256);
        const rows = 8, cols = 6;
        const rh = 256 / rows, cw = 256 / cols;
        for (let r = 0; r < rows; r++) {
            const off = (r % 2) * (cw * 0.5);
            for (let col = -1; col <= cols; col++) {
                const shade = 44 + ((r * 7 + col * 13) % 22);
                g.fillStyle = `rgb(${shade}, ${shade + 10}, ${shade + 24})`;
                g.fillRect(col * cw + off + 1, r * rh + 1, cw - 2, rh - 2);
            }
            g.fillStyle = 'rgba(15,23,42,0.45)';
            g.fillRect(0, r * rh + rh - 2, 256, 2);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
        return tex;
    }

    function createStoneTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#475569';
        g.fillRect(0, 0, 256, 256);
        for (let r = 0; r < 8; r++) {
            const off = (r % 2) * 20;
            for (let col = -1; col < 7; col++) {
                const v = 88 + ((r * 19 + col * 31) % 42);
                g.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
                g.fillRect(col * 40 + off + 2, r * 32 + 2, 36, 28);
            }
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(3, 1);
        return tex;
    }

    function createTerrainTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#cbd5c0';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 1400; i++) {
            const x = (i * 73) % 256;
            const y = (i * 137) % 256;
            g.fillStyle = i % 3 === 0 ? 'rgba(34, 84, 48, 0.18)' : (i % 3 === 1 ? 'rgba(120, 113, 88, 0.14)' : 'rgba(255,255,255,0.08)');
            g.fillRect(x, y, 4, 4);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(90, 90);
        return tex;
    }

    function createWaterTexture() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const g = c.getContext('2d');
        g.fillStyle = '#1d6f8a';
        g.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 420; i++) {
            const x = Math.random() * 256;
            const y = Math.random() * 256;
            const w = 12 + Math.random() * 34;
            g.fillStyle = i % 2 === 0 ? 'rgba(125, 211, 252, 0.10)' : 'rgba(12, 74, 110, 0.14)';
            g.fillRect(x, y, w, 2);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(70, 70);
        return tex;
    }

    function createSkyTexture() {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 512;
        const g = c.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0.00, '#1e4e79');
        grad.addColorStop(0.32, '#4a89b8');
        grad.addColorStop(0.50, '#a8d1ea');
        grad.addColorStop(0.56, '#dbeafe');
        grad.addColorStop(1.00, '#94b8cf');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 512);
        return new THREE.CanvasTexture(c);
    }

    function buildCabinExterior() {
        const cabin = new THREE.Group();

        const stoneTex = createStoneTexture();
        const stoneMat = new THREE.MeshStandardMaterial({
            color: 0x94a3b8,
            map: stoneTex,
            bumpMap: stoneTex,
            bumpScale: 0.04,
            roughness: 0.92,
            metalness: 0.05
        });
        const pier = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.3, 8.2), stoneMat);
        pier.position.set(0.3, -0.66, 1.5);
        pier.receiveShadow = true;
        pier.castShadow = true;
        cabin.add(pier);

        const logTex = createLogTexture();
        const woodDeckMat = new THREE.MeshStandardMaterial({
            color: 0x9a623c,
            map: logTex,
            bumpMap: logTex,
            bumpScale: 0.02,
            roughness: 0.78
        });
        const deck = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.10, 3.2), woodDeckMat);
        deck.position.set(0.3, -0.04, 3.95);
        deck.receiveShadow = true;
        cabin.add(deck);

        // Guarda-corpo de madeira do deck (com vão na direita para descer à península)
        const postMat = new THREE.MeshStandardMaterial({ color: 0x5c341d, roughness: 0.8 });
        for (let px = -4.1; px <= 4.7; px += 1.1) {
            if (px > 3.2 && px < 4.5) continue;
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.92, 0.10), postMat);
            post.position.set(px, 0.44, 5.45);
            post.castShadow = true;
            cabin.add(post);
        }
        const railFrontL = new THREE.Mesh(new THREE.BoxGeometry(7.3, 0.08, 0.08), postMat);
        railFrontL.position.set(-0.6, 0.88, 5.45);
        cabin.add(railFrontL);
        const railLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.0), postMat);
        railLeft.position.set(-4.15, 0.88, 3.95);
        cabin.add(railLeft);

        // Ponte/passarela de madeira conectando o deck à terra firme da península
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.12, 2.6), woodDeckMat);
        bridge.position.set(8.8, -0.05, 3.8);
        bridge.receiveShadow = true;
        cabin.add(bridge);

        // Revestimento externo em toras reais da Casa da Lagoa
        const logMat = new THREE.MeshStandardMaterial({
            color: 0xa16b42,
            map: logTex,
            bumpMap: logTex,
            bumpScale: 0.045,
            roughness: 0.84
        });
        const shingleTex = createShingleTexture();
        const roofMat = new THREE.MeshStandardMaterial({
            color: 0x64748b,
            map: shingleTex,
            bumpMap: shingleTex,
            bumpScale: 0.035,
            roughness: 0.72,
            metalness: 0.18
        });
        const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a2815, roughness: 0.8 });

        cabinRoofGroup = new THREE.Group();
        cabinRoofGroup.visible = (cam.mode === 'fps');

        // Paredes externas de toras (fundo, laterais e frente com vão da porta!)
        const logBack = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.65, 0.18), logMat);
        logBack.position.set(0.45, 1.82, -2.22);
        logBack.castShadow = true;
        logBack.receiveShadow = true;
        cabinRoofGroup.add(logBack);

        const logLeft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.65, 4.9), logMat);
        logLeft.position.set(-2.76, 1.82, 0.23);
        logLeft.castShadow = true;
        logLeft.receiveShadow = true;
        cabinRoofGroup.add(logLeft);

        const logRight = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.65, 4.9), logMat);
        logRight.position.set(3.66, 1.82, 0.23);
        logRight.castShadow = true;
        logRight.receiveShadow = true;
        cabinRoofGroup.add(logRight);

        // Fachada frontal de toras por fora da parede branca interna (com vão da porta x: 1.78..2.72)
        const logFrontL = new THREE.Mesh(new THREE.BoxGeometry(4.64, 3.65, 0.14), logMat);
        logFrontL.position.set(-0.54, 1.82, 2.55);
        logFrontL.castShadow = true;
        logFrontL.receiveShadow = true;
        cabinRoofGroup.add(logFrontL);

        const logFrontR = new THREE.Mesh(new THREE.BoxGeometry(1.04, 3.65, 0.14), logMat);
        logFrontR.position.set(3.24, 1.82, 2.55);
        logFrontR.castShadow = true;
        logFrontR.receiveShadow = true;
        cabinRoofGroup.add(logFrontR);

        const logFrontTop = new THREE.Mesh(new THREE.BoxGeometry(0.96, 1.45, 0.14), logMat);
        logFrontTop.position.set(2.25, 2.92, 2.55);
        logFrontTop.castShadow = true;
        cabinRoofGroup.add(logFrontTop);

        // Telhado alpino em duas águas perfeitamente alinhadas na cumeeira (x = 0.45)
        const roofSlopeL = new THREE.Mesh(new THREE.BoxGeometry(4.85, 0.18, 7.6), roofMat);
        roofSlopeL.position.set(-1.35, 4.55, 0.65);
        roofSlopeL.rotation.z = 0.56;
        roofSlopeL.castShadow = true;
        roofSlopeL.receiveShadow = true;
        cabinRoofGroup.add(roofSlopeL);

        const roofSlopeR = new THREE.Mesh(new THREE.BoxGeometry(4.85, 0.18, 7.6), roofMat);
        roofSlopeR.position.set(2.25, 4.55, 0.65);
        roofSlopeR.rotation.z = -0.56;
        roofSlopeR.castShadow = true;
        roofSlopeR.receiveShadow = true;
        cabinRoofGroup.add(roofSlopeR);

        const ridgeBeam = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 7.7), trimMat);
        ridgeBeam.position.set(0.45, 5.66, 0.65);
        cabinRoofGroup.add(ridgeBeam);

        // Frontão triangular da frente + janela emoldurada sem z-fighting
        const gableShape = new THREE.Shape();
        gableShape.moveTo(-3.35, 0);
        gableShape.lineTo(3.35, 0);
        gableShape.lineTo(0, 2.15);
        gableShape.closePath();
        const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: 0.16, bevelEnabled: false });
        const gableFront = new THREE.Mesh(gableGeo, logMat);
        gableFront.position.set(0.45, 3.56, 2.48);
        cabinRoofGroup.add(gableFront);
        const gableBack = new THREE.Mesh(gableGeo, logMat);
        gableBack.position.set(0.45, 3.56, -2.30);
        cabinRoofGroup.add(gableBack);

        const atticFrame = new THREE.Mesh(new THREE.BoxGeometry(1.42, 1.06, 0.08), trimMat);
        atticFrame.position.set(0.45, 4.35, 2.66);
        cabinRoofGroup.add(atticFrame);
        const atticWin = new THREE.Mesh(
            new THREE.BoxGeometry(1.24, 0.88, 0.04),
            new THREE.MeshBasicMaterial({ color: 0xfef08a })
        );
        atticWin.position.set(0.45, 4.35, 2.70);
        cabinRoofGroup.add(atticWin);

        // Chaminé de pedra
        const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.75, 2.5, 0.75), stoneMat);
        chimney.position.set(0.45, 5.5, 0.2);
        chimney.castShadow = true;
        cabinRoofGroup.add(chimney);

        // Lanternas quentes na varanda
        [-2.0, 1.2, 3.2].forEach(lx => {
            const lantern = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.22, 0.14),
                new THREE.MeshBasicMaterial({ color: 0xfef08a })
            );
            lantern.position.set(lx, 2.45, 2.68);
            cabinRoofGroup.add(lantern);
        });
        const porchLight = new THREE.PointLight(0xfde68a, 0.9, 12, 1.6);
        porchLight.position.set(0.5, 2.5, 3.6);
        cabinRoofGroup.add(porchLight);

        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.0), trimMat);
        beam.position.set(-4.15, 0.45, 3.95);
        cabin.add(beam);

        cabin.add(cabinRoofGroup);
        return cabin;
    }

    function buildWorld() {
        const world = new THREE.Group();

        // Céu alpino em domo 360° (1km+)
        const skyDome = new THREE.Mesh(
            new THREE.SphereGeometry(680, 28, 18),
            new THREE.MeshBasicMaterial({ map: createSkyTexture(), side: THREE.BackSide, fog: false })
        );
        world.add(skyDome);

        // Sol dourado + nuvens suaves
        const sunMesh = new THREE.Mesh(
            new THREE.SphereGeometry(18, 16, 16),
            new THREE.MeshBasicMaterial({ color: 0xfffbeb, fog: false })
        );
        sunMesh.position.set(190, 155, -340);
        world.add(sunMesh);

        const cloudMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.72, fog: false });
        for (let c = 0; c < 18; c++) {
            const cg = new THREE.Group();
            const ang = (c / 18) * Math.PI * 2;
            const dist = 240 + (c % 3) * 85;
            cg.position.set(Math.cos(ang) * dist, 95 + (c % 4) * 18, Math.sin(ang) * dist);
            for (let p = 0; p < 3; p++) {
                const puff = new THREE.Mesh(new THREE.SphereGeometry(14 + (p % 2) * 7, 10, 8), cloudMat);
                puff.position.set((p - 1) * 14, (p % 2) * 4, 0);
                puff.scale.set(1.6, 0.55, 1.0);
                cg.add(puff);
            }
            world.add(cg);
        }

        // Lagoa Azul-Turquesa (1000m x 1000m)
        waterTexRef = createWaterTexture();
        const water = new THREE.Mesh(
            new THREE.PlaneGeometry(1000, 1000),
            new THREE.MeshStandardMaterial({
                color: 0x2084a4,
                map: waterTexRef,
                roughness: 0.14,
                metalness: 0.34
            })
        );
        water.rotation.x = -Math.PI / 2;
        water.position.y = -0.26;
        water.receiveShadow = true;
        world.add(water);

        // Terreno 1km x 1km (península, margens e montanhas alpinas)
        const tGeo = new THREE.PlaneGeometry(1000, 1000, 130, 130);
        tGeo.rotateX(-Math.PI / 2);
        const pos = tGeo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const colShore = new THREE.Color(0x8d826c);
        const colGrass = new THREE.Color(0x2f5a3a);
        const colRock = new THREE.Color(0x52606d);
        const colSnow = new THREE.Color(0xe2e8f0);
        const tmpCol = new THREE.Color();

        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const z = pos.getZ(i);
            const y = terrainHeight(x, z);
            pos.setY(i, y);

            if (y < 0.25) {
                tmpCol.copy(colShore);
            } else if (y < 14) {
                tmpCol.copy(colGrass).lerp(colRock, Math.max(0, (y - 6) / 10));
            } else if (y < 62) {
                tmpCol.copy(colRock);
            } else {
                tmpCol.copy(colRock).lerp(colSnow, Math.min(1, (y - 62) / 36));
            }
            colors[i * 3] = tmpCol.r;
            colors[i * 3 + 1] = tmpCol.g;
            colors[i * 3 + 2] = tmpCol.b;
        }
        tGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        tGeo.computeVertexNormals();

        const terrainTex = createTerrainTexture();
        const terrain = new THREE.Mesh(
            tGeo,
            new THREE.MeshStandardMaterial({ map: terrainTex, vertexColors: true, roughness: 0.94, metalness: 0.02 })
        );
        terrain.receiveShadow = true;
        world.add(terrain);

        // Floresta de Pinheiros em 3 camadas via InstancedMesh (~900 árvores + pedras na margem)
        const MAX_TREES = 900;
        const trunkGeo = new THREE.CylinderGeometry(0.13, 0.24, 2.3, 6);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e1b, roughness: 0.9 });
        const pineGeo1 = new THREE.ConeGeometry(1.65, 3.4, 8);
        const pineGeo2 = new THREE.ConeGeometry(1.30, 3.1, 8);
        const pineGeo3 = new THREE.ConeGeometry(0.92, 2.7, 8);
        const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });

        const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_TREES);
        const pineInst1 = new THREE.InstancedMesh(pineGeo1, pineMat, MAX_TREES);
        const pineInst2 = new THREE.InstancedMesh(pineGeo2, pineMat, MAX_TREES);
        const pineInst3 = new THREE.InstancedMesh(pineGeo3, pineMat, MAX_TREES);
        trunkInst.castShadow = true;
        pineInst1.castShadow = true;
        pineInst2.castShadow = true;
        pineInst3.castShadow = true;

        const dummy = new THREE.Object3D();
        const treeCol = new THREE.Color();
        let treeCount = 0;
        let seed = 42;
        function rand() {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        }
        for (let attempt = 0; attempt < 4200 && treeCount < MAX_TREES; attempt++) {
            const x = (rand() - 0.5) * 520;
            const z = (rand() - 0.5) * 520;
            if (x > -8 && x < 10 && z > -7 && z < 9) continue;
            const y = terrainHeight(x, z);
            if (y < 0.15 || y > 34) continue;

            const sc = 0.78 + rand() * 0.95;
            dummy.position.set(x, y + 1.0 * sc, z);
            dummy.scale.set(sc, sc, sc);
            dummy.rotation.y = rand() * Math.PI * 2;
            dummy.updateMatrix();
            trunkInst.setMatrixAt(treeCount, dummy.matrix);

            dummy.position.set(x, y + 2.9 * sc, z);
            dummy.updateMatrix();
            pineInst1.setMatrixAt(treeCount, dummy.matrix);

            dummy.position.set(x, y + 4.4 * sc, z);
            dummy.updateMatrix();
            pineInst2.setMatrixAt(treeCount, dummy.matrix);

            dummy.position.set(x, y + 5.8 * sc, z);
            dummy.updateMatrix();
            pineInst3.setMatrixAt(treeCount, dummy.matrix);

            treeCol.setHSL(0.36 + (rand() - 0.5) * 0.05, 0.44 + rand() * 0.14, 0.16 + rand() * 0.09);
            pineInst1.setColorAt(treeCount, treeCol);
            pineInst2.setColorAt(treeCount, treeCol);
            pineInst3.setColorAt(treeCount, treeCol);

            treeCount++;
        }
        trunkInst.count = treeCount;
        pineInst1.count = treeCount;
        pineInst2.count = treeCount;
        pineInst3.count = treeCount;
        trunkInst.instanceMatrix.needsUpdate = true;
        pineInst1.instanceMatrix.needsUpdate = true;
        pineInst2.instanceMatrix.needsUpdate = true;
        pineInst3.instanceMatrix.needsUpdate = true;
        if (pineInst1.instanceColor) pineInst1.instanceColor.needsUpdate = true;
        if (pineInst2.instanceColor) pineInst2.instanceColor.needsUpdate = true;
        if (pineInst3.instanceColor) pineInst3.instanceColor.needsUpdate = true;
        world.add(trunkInst);
        world.add(pineInst1);
        world.add(pineInst2);
        world.add(pineInst3);

        // Pedras naturais pegáveis na península e margem da lagoa
        const rockGeo = new THREE.DodecahedronGeometry(0.36, 0);
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.88, metalness: 0.05 });
        let rockCount = 0;
        for (let rIdx = 0; rIdx < 700 && rockCount < 48; rIdx++) {
            const x = (rand() - 0.5) * 140;
            const z = (rand() - 0.5) * 140;
            if (x > -11 && x < 12 && z > -10 && z < 13) continue;
            const y = terrainHeight(x, z);
            if (y < -0.15 || y > 2.8) continue;
            const rs = 0.65 + rand() * 0.95;
            const rock = new THREE.Mesh(rockGeo, rockMat);
            rock.position.set(x, y + 0.18 * rs, z);
            rock.scale.set(rs * 1.2, rs * 0.78, rs);
            rock.rotation.set(rand() * 2, rand() * 3, rand() * 2);
            rock.castShadow = true;
            rock.receiveShadow = true;
            world.add(rock);
            registerPickable(rock, { halfH: 0.22 * rs, holdDist: 1.45, rockIndex: rockCount });
            pickableRocks.push(rock);
            rockCount++;
        }

        // Névoa suave pairando sobre a lagoa ao amanhecer
        const mistMat = new THREE.MeshBasicMaterial({
            color: 0xe2f1fa,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        for (let m = 0; m < 12; m++) {
            const mistPlane = new THREE.Mesh(new THREE.PlaneGeometry(42, 16), mistMat);
            const ang = (m / 12) * Math.PI * 2;
            const rad = 28 + (m % 3) * 24;
            mistPlane.position.set(Math.cos(ang) * rad, 0.35, Math.sin(ang) * rad + 16);
            mistPlane.rotation.x = -Math.PI / 2;
            mistPlane.rotation.z = ang;
            world.add(mistPlane);
            lakeMists.push({ mesh: mistPlane, baseX: mistPlane.position.x, phase: m * 0.7 });
        }

        return world;
    }

    function buildStreamlines() {
        const group = new THREE.Group();
        group.visible = showStreamlines;

        const paths = [
            {
                key: 'ar',
                color: 0x38bdf8,
                pts: [
                    new THREE.Vector3(-2.18, 2.55, -0.35),
                    new THREE.Vector3(-1.40, 2.25, -0.15),
                    new THREE.Vector3(-0.70, 2.38, -0.25),
                    new THREE.Vector3(GX + 0.05, H + 0.35, GZ - 0.20)
                ],
                arrows: 4,
                speed: 0.28
            },
            {
                key: 'exaust',
                color: 0x22d3ee,
                pts: [
                    new THREE.Vector3(GX + 0.05, H + 0.35, GZ - 0.20),
                    new THREE.Vector3(GX + 0.05, H - 0.15, GZ - 0.20),
                    new THREE.Vector3(GX - 0.12, 1.35, GZ - 0.05),
                    new THREE.Vector3(GX - 0.22, 0.35, GZ + 0.22)
                ],
                arrows: 4,
                speed: 0.34
            },
            {
                key: 'duct',
                color: 0x34d399,
                pts: [
                    new THREE.Vector3(GX - 0.22, 0.35, GZ + 0.22),
                    new THREE.Vector3(GX - halfW + 0.04, 0.19, GZ + 0.35),
                    new THREE.Vector3(GX - halfW - 0.38, 0.11, GZ + 0.48),
                    new THREE.Vector3(GX - halfW - 0.95, 0.20, GZ + 0.68)
                ],
                arrows: 4,
                speed: 0.32
            },
            {
                key: 'umid',
                color: 0x7dd3fc,
                pts: [
                    new THREE.Vector3(1.05 - 0.18, 1.72, -0.55),
                    new THREE.Vector3(1.05 - 0.15, 2.25, -0.50),
                    new THREE.Vector3(GX + halfW - 0.12, 2.15, GZ + 0.15),
                    new THREE.Vector3(GX + 0.10, 1.45, GZ + 0.05)
                ],
                arrows: 3,
                speed: 0.26
            }
        ];

        const coneGeo = new THREE.ConeGeometry(0.042, 0.11, 10);
        paths.forEach(cfg => {
            const curve = new THREE.CatmullRomCurve3(cfg.pts);
            const tubeMat = new THREE.MeshBasicMaterial({
                color: cfg.color,
                transparent: true,
                opacity: 0.28,
                depthWrite: false
            });
            const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.012, 6, false), tubeMat);
            group.add(tube);

            const arrowMat = new THREE.MeshBasicMaterial({ color: cfg.color });
            for (let i = 0; i < cfg.arrows; i++) {
                const cone = new THREE.Mesh(coneGeo, arrowMat);
                group.add(cone);
                flowArrows.push({
                    mesh: cone,
                    curve,
                    key: cfg.key,
                    offset: i / cfg.arrows,
                    speed: cfg.speed
                });
            }
        });

        streamlinesGroup = group;
        return group;
    }

    function bindControls(el) {
        const raycaster = new THREE.Raycaster();
        const pointerNdc = new THREE.Vector2();
        const touchTaps = {};

        el.addEventListener('pointerdown', (e) => {
            if (cam.mode === 'fps' && e.pointerType === 'touch') {
                touchTaps[e.pointerId] = { x: e.clientX, y: e.clientY };
                return;
            }
            if (e.isPrimary === false) return;
            cam.downX = e.clientX; cam.downY = e.clientY;
            cam.lastX = e.clientX; cam.lastY = e.clientY;
            if (cam.mode === 'fps' && e.pointerType === 'mouse' && document.pointerLockElement !== el && el.requestPointerLock) {
                try { el.requestPointerLock(); } catch (err) {}
            }
            cam.dragging = true;
            cam.pinchDist = 0;
        });
        document.addEventListener('pointerlockchange', () => {
            const locked = document.pointerLockElement === el;
            if (typeof window.onTwinPointerLockChange === 'function') {
                window.onTwinPointerLockChange(locked);
            }
        });
        window.addEventListener('pointermove', (e) => {
            if (cam.mode === 'fps' && document.pointerLockElement === el) {
                cam.fpsYaw -= (e.movementX || 0) * 0.0022;
                cam.fpsPitch = Math.max(-1.1, Math.min(1.1, cam.fpsPitch - (e.movementY || 0) * 0.0020));
                return;
            }
            if (cam.dragging) {
                if (e.isPrimary === false || cam.pinchDist > 0) return;
                const dx = e.clientX - cam.lastX;
                const dy = e.clientY - cam.lastY;
                if (cam.mode === 'fps') {
                    cam.fpsYaw -= dx * 0.0055;
                    cam.fpsPitch = Math.max(-1.1, Math.min(1.1, cam.fpsPitch - dy * 0.005));
                } else {
                    cam.targetTheta -= dx * 0.008;
                    cam.targetPhi = Math.max(0.35, Math.min(1.50, cam.targetPhi - dy * 0.006));
                }
                cam.lastX = e.clientX; cam.lastY = e.clientY;
                return;
            }
            if (e.target === el && cam.mode !== 'fps' && interactiveMeshes.length) {
                const rect = el.getBoundingClientRect();
                pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycaster.setFromCamera(pointerNdc, camera);
                const hits = raycaster.intersectObjects(interactiveMeshes, false);
                el.style.cursor = hits.length ? 'pointer' : 'grab';
            }
        });
        window.addEventListener('pointerup', (e) => {
            const wasDragging = cam.dragging;
            cam.dragging = false;
            const touchTap = touchTaps[e.pointerId];
            if (touchTap) delete touchTaps[e.pointerId];
            const isTouchFpsTap = cam.mode === 'fps' && e.pointerType === 'touch' && !!touchTap;
            if ((!wasDragging && !isTouchFpsTap) || !el.contains(e.target)) return;
            const refX = isTouchFpsTap ? touchTap.x : cam.downX;
            const refY = isTouchFpsTap ? touchTap.y : cam.downY;
            const moved = Math.hypot(e.clientX - refX, e.clientY - refY);
            if (moved < (e.pointerType === 'touch' ? 12 : 6)) {
                if (cam.mode === 'fps' && heldRock) {
                    if (lastSnapTarget) {
                        heldRock.position.set(lastSnapTarget.x, lastSnapTarget.y, lastSnapTarget.z);
                        heldRock.userData.supportedBy = lastSnapTarget.shelf || null;
                        heldRock.userData.velY = 0;
                        if (typeof lastSnapTarget.wallRotY === 'number') {
                            heldRock.rotation.y = lastSnapTarget.wallRotY;
                        }
                        if (typeof heldRock.userData.itemIndex === 'number') {
                            pendingDroppedItems.push({
                                id: heldRock.userData.itemIndex,
                                x: heldRock.position.x,
                                y: heldRock.position.y,
                                z: heldRock.position.z,
                                ry: heldRock.rotation.y
                            });
                        }
                    } else {
                        heldRock.userData.supportedBy = null;
                        heldRock.userData.velY = 0;
                        fallingRocks.push(heldRock);
                    }
                    heldRock = null;
                    lastSnapTarget = null;
                    if (snapPreviewMesh) snapPreviewMesh.visible = false;
                    if (typeof window.onTwinHeldChange === 'function') window.onTwinHeldChange(false);
                    return;
                }
                if (interactiveMeshes.length) {
                    const rect = el.getBoundingClientRect();
                    pointerNdc.x = cam.mode === 'fps' && document.pointerLockElement === el ? 0 : ((e.clientX - rect.left) / rect.width) * 2 - 1;
                    pointerNdc.y = cam.mode === 'fps' && document.pointerLockElement === el ? 0 : -((e.clientY - rect.top) / rect.height) * 2 + 1;
                    raycaster.setFromCamera(pointerNdc, camera);
                    const hits = raycaster.intersectObjects(interactiveMeshes, false);
                    if (hits.length) {
                        const hit = hits[0];
                        const eqId = hit.object.userData.equipId;
                        if (eqId === 'porta') {
                            window.toggleTwinDoor();
                            return;
                        }
                        const pickTarget = hit.object.userData.pickRoot || (hit.object.userData.isPickable ? hit.object : null);
                        if (cam.mode === 'fps' && pickTarget && hit.distance < 7.5) {
                            heldRock = pickTarget;
                            heldYawOffset = heldRock.rotation.y - cam.fpsYaw;
                            heldRock.userData.supportedBy = null;
                            const fi = fallingRocks.indexOf(heldRock);
                            if (fi !== -1) fallingRocks.splice(fi, 1);
                            if (heldRock.userData.isShelf) {
                                dropUnsupportedItems(heldRock);
                            }
                            if (typeof window.onTwinHeldChange === 'function') window.onTwinHeldChange(true);
                            return;
                        }
                        if (cam.mode !== 'fps' && eqId) {
                            window.focusTwinEquipment(eqId);
                            if (typeof window.onTwinEquipSelect === 'function') {
                                window.onTwinEquipSelect(eqId);
                            }
                            return;
                        }
                    }
                }
                if (cam.mode === 'fps') {
                    grabAnim = 1.0;
                }
            }
        });

        window.addEventListener('keydown', (e) => {
            if (cam.mode !== 'fps') return;
            const k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') { cam.keys.w = true; e.preventDefault(); }
            if (k === 's' || e.key === 'ArrowDown') { cam.keys.s = true; e.preventDefault(); }
            if (k === 'a' || e.key === 'ArrowLeft') { cam.keys.a = true; e.preventDefault(); }
            if (k === 'd' || e.key === 'ArrowRight') { cam.keys.d = true; e.preventDefault(); }
            if (e.key === 'Shift') cam.keys.shift = true;
            if (e.code === 'Space' || e.key === ' ') {
                e.preventDefault();
                if (window.triggerTwinJump) window.triggerTwinJump();
            }
            if (k === 'e') {
                const dPorta = Math.hypot(cam.fpsX - 2.25, cam.fpsZ - 2.45);
                if (dPorta < 2.6) window.toggleTwinDoor();
            }
        });
        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') cam.keys.w = false;
            if (k === 's' || e.key === 'ArrowDown') cam.keys.s = false;
            if (k === 'a' || e.key === 'ArrowLeft') cam.keys.a = false;
            if (k === 'd' || e.key === 'ArrowRight') cam.keys.d = false;
            if (e.key === 'Shift') cam.keys.shift = false;
        });

        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (cam.mode === 'fps' && heldRock) {
                heldYawOffset += (e.deltaY > 0 ? -1 : 1) * (Math.PI / 12);
                return;
            }
            cam.targetRadius = Math.max(1.1, Math.min(48.0, cam.targetRadius + e.deltaY * 0.008));
        }, { passive: false });

        let lookTouchId = null, lookLastX = 0, lookLastY = 0;

        el.addEventListener('touchstart', (e) => {
            if (cam.mode === 'fps') {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (lookTouchId === null) {
                        lookTouchId = t.identifier;
                        lookLastX = t.clientX;
                        lookLastY = t.clientY;
                    }
                }
                return;
            }
            if (e.touches.length === 2) {
                cam.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            }
        }, { passive: true });
        el.addEventListener('touchmove', (e) => {
            if (cam.mode === 'fps') {
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (t.identifier === lookTouchId) {
                        const dx = t.clientX - lookLastX;
                        const dy = t.clientY - lookLastY;
                        cam.fpsYaw -= dx * 0.0048;
                        cam.fpsPitch = Math.max(-1.1, Math.min(1.1, cam.fpsPitch - dy * 0.0042));
                        lookLastX = t.clientX;
                        lookLastY = t.clientY;
                    }
                }
                return;
            }
            if (e.touches.length === 2 && cam.pinchDist > 0) {
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                cam.targetRadius = Math.max(1.5, Math.min(48.0, cam.targetRadius - (dist - cam.pinchDist) * 0.03));
                cam.pinchDist = dist;
            }
        }, { passive: true });
        el.addEventListener('touchend', (e) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === lookTouchId) lookTouchId = null;
            }
        }, { passive: true });
        el.addEventListener('touchcancel', () => { lookTouchId = null; }, { passive: true });
        el.addEventListener('dblclick', () => {
            if (cam.mode === 'fps') return;
            window.resetTwinCamera();
        });

        function clearInputs() {
            cam.keys = { w: false, s: false, a: false, d: false, shift: false, lookL: false, lookR: false, lookU: false, lookD: false };
            cam.joyX = 0;
            cam.joyY = 0;
            cam.fpsMoving = false;
            cam.dragging = false;
            lookTouchId = null;
        }
        window.addEventListener('blur', clearInputs);
        document.addEventListener('visibilitychange', () => { if (document.hidden) clearInputs(); });
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!renderer || !scene || !camera) return;

        const w = container.clientWidth, h = container.clientHeight;
        if (w > 0 && h > 0) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const aspect = w / h;
            const targetFov = cam.mode === 'fps' ? (aspect < 0.85 ? 76 : 68) : (aspect < 0.85 ? 54 : 44);
            if (renderer.domElement.width !== Math.floor(w * dpr) || renderer.domElement.height !== Math.floor(h * dpr) || camera.fov !== targetFov) {
                renderer.setSize(w, h, false);
                camera.aspect = aspect;
                camera.fov = targetFov;
                camera.updateProjectionMatrix();
            }
        }

        if (cam.mode === 'fps') {
            if (cam.keys.lookL) cam.fpsYaw += 0.042;
            if (cam.keys.lookR) cam.fpsYaw -= 0.042;
            if (cam.keys.lookU) cam.fpsPitch = Math.min(1.1, cam.fpsPitch + 0.032);
            if (cam.keys.lookD) cam.fpsPitch = Math.max(-1.1, cam.fpsPitch - 0.032);

            const joyMag = Math.hypot(cam.joyX, cam.joyY);
            const joyDead = joyMag < 0.08 ? 0 : (joyMag - 0.08) / 0.92;
            const joyScale = joyMag > 0.001 ? joyDead / joyMag : 0;
            const jx = cam.joyX * joyScale;
            const jy = cam.joyY * joyScale;
            const speed = cam.keys.shift ? 0.16 : (joyMag > 0.08 ? (0.045 + 0.070 * joyDead) : 0.068);
            const fwdX = -Math.sin(cam.fpsYaw);
            const fwdZ = -Math.cos(cam.fpsYaw);
            const rightX = Math.cos(cam.fpsYaw);
            const rightZ = -Math.sin(cam.fpsYaw);
            const fwdIn = (cam.keys.w ? 1 : 0) - (cam.keys.s ? 1 : 0) + jy;
            const strIn = (cam.keys.d ? 1 : 0) - (cam.keys.a ? 1 : 0) + jx;
            let mx = fwdX * fwdIn * speed + rightX * strIn * speed;
            let mz = fwdZ * fwdIn * speed + rightZ * strIn * speed;

            let nx = Math.max(-450, Math.min(450, cam.fpsX + mx));
            let nz = Math.max(-450, Math.min(450, cam.fpsZ + mz));

            // Colisão com a estufa (acompanha onde a estufa foi colocada)
            if (tentGroup && heldRock !== tentGroup && Math.abs((cam.fpsY - 1.62) - tentGroup.position.y) < 2.2) {
                const tgx = tentGroup.position.x, tgz = tentGroup.position.z;
                const inTentX = nx > tgx - halfW - 0.18 && nx < tgx + halfW + 0.18;
                const inTentZ = nz > tgz - halfD - 0.18 && nz < tgz + halfD - 0.05;
                if (inTentX && inTentZ) {
                    nx = cam.fpsX;
                    nz = cam.fpsZ;
                }
            }

            // Colisão com a parede frontal e folha da porta (só passa se a porta estiver aberta!)
            const inFrontWallBand = (nz >= 2.28 && nz <= 2.66) && nx >= -2.9 && nx <= 3.7;
            if (inFrontWallBand) {
                const inOpenDoorway = (nx >= 1.82 && nx <= 2.68) && roomDoorAngle > 0.85;
                if (!inOpenDoorway) {
                    nz = cam.fpsZ;
                }
            }
            // Folha sólida da porta aberta para fora (x ~ 2.70, z: 2.45..3.35)
            if (roomDoorAngle > 0.85 && nx > 2.54 && nx < 2.86 && nz > 2.45 && nz < 3.35) {
                nx = cam.fpsX;
                nz = cam.fpsZ;
            }
            const crossingBackOrSide = (nx < -2.4 && nx > -3.0 && nz > -2.3 && nz < 2.6)
                || (nx > 3.3 && nx < 3.9 && nz > -2.3 && nz < 2.6)
                || (nz < -1.9 && nz > -2.5 && nx > -2.8 && nx < 3.7);
            if (crossingBackOrSide) {
                nx = cam.fpsX;
                nz = cam.fpsZ;
            }

            // Mantém jogador em terra firme / deck / ponte (não afunda na lagoa)
            const gh = getGroundHeight(nx, nz);
            if (gh < -0.18) {
                nx = cam.fpsX;
                nz = cam.fpsZ;
            }

            const actuallyMoved = Math.hypot(nx - cam.fpsX, nz - cam.fpsZ) > 0.0008;
            cam.fpsMoving = actuallyMoved;
            cam.fpsX = nx;
            cam.fpsZ = nz;
            const floorEyeY = Math.max(0.0, getGroundHeight(cam.fpsX, cam.fpsZ)) + 1.62;
            cam.fpsVelY -= 0.011;
            cam.fpsY += cam.fpsVelY;
            if (cam.fpsY <= floorEyeY) {
                cam.fpsY = floorEyeY;
                cam.fpsVelY = 0;
                cam.fpsGrounded = true;
            }
            const walking = actuallyMoved;
            const bobFreq = cam.keys.shift ? 12.5 : 7.5;
            const bob = (walking && cam.fpsGrounded) ? Math.sin(simTime * bobFreq) * 0.028 : 0;

            camera.position.set(cam.fpsX, cam.fpsY + bob, cam.fpsZ);
            camera.lookAt(
                cam.fpsX + fwdX * Math.cos(cam.fpsPitch),
                cam.fpsY + bob + Math.sin(cam.fpsPitch),
                cam.fpsZ + fwdZ * Math.cos(cam.fpsPitch)
            );

            if (grabAnim > 0) grabAnim = Math.max(0, grabAnim - 0.08);
            if (fpsHandsGroup) {
                fpsHandsGroup.visible = true;
                const sw = walking ? Math.sin(simTime * bobFreq) : 0;
                const swCos = walking ? Math.cos(simTime * bobFreq) : 0;
                const airDip = cam.fpsGrounded ? 0 : Math.max(-0.06, Math.min(0.06, -cam.fpsVelY * 0.25));
                const idleBreath = Math.sin(simTime * 2.2) * 0.005;

                if (heldRock) {
                    // Mãozinhas estendidas apontando para o objeto flutuando à frente
                    fpsHandL.position.set(-0.20, -0.14 + idleBreath, -0.48);
                    fpsHandL.rotation.set(0.18, -0.28, 0);
                    fpsHandR.position.set(0.20, -0.14 + idleBreath, -0.48);
                    fpsHandR.rotation.set(0.18, 0.28, 0);
                } else {
                    const reach = Math.sin(grabAnim * Math.PI) * 0.20;
                    fpsHandL.position.set(-0.28 + swCos * 0.012 + reach * 0.25, -0.24 + sw * 0.032 + idleBreath + airDip + reach * 0.25, -0.40 - sw * 0.055 - reach);
                    fpsHandL.rotation.set(-0.35 + sw * 0.28 + reach * 1.4, -reach * 0.4, 0);
                    fpsHandR.position.set(0.28 - swCos * 0.012 - reach * 0.25, -0.24 - sw * 0.032 + idleBreath + airDip + reach * 0.25, -0.40 + sw * 0.055 - reach);
                    fpsHandR.rotation.set(-0.35 - sw * 0.28 + reach * 1.4, reach * 0.4, 0);
                }
            }

            if (heldRock) {
                const dir = new THREE.Vector3();
                camera.getWorldDirection(dir);
                const distHold = heldRock.userData.holdDist || 1.45;
                const tx = camera.position.x + dir.x * distHold;
                const ty = camera.position.y + dir.y * distHold - 0.10 + Math.sin(simTime * 3.0) * 0.025;
                const tz = camera.position.z + dir.z * distHold;
                heldRock.position.x += (tx - heldRock.position.x) * 0.28;
                heldRock.position.y += (ty - heldRock.position.y) * 0.28;
                heldRock.position.z += (tz - heldRock.position.z) * 0.28;
                if (heldRock.userData.isPickableRock) {
                    heldRock.rotation.y += 0.018;
                } else {
                    const targetYaw = cam.fpsYaw + heldYawOffset;
                    let dy = targetYaw - heldRock.rotation.y;
                    while (dy > Math.PI) dy -= Math.PI * 2;
                    while (dy < -Math.PI) dy += Math.PI * 2;
                    heldRock.rotation.y += dy * 0.22;
                }

                lastSnapTarget = findPlacementTarget(heldRock);
                if (snapPreviewMesh) {
                    if (lastSnapTarget) {
                        const rScale = heldRock.userData.isShelf ? 2.4 : 1.0;
                        snapPreviewMesh.scale.set(rScale, rScale, 1);
                        snapPreviewMesh.visible = true;
                        snapPreviewMesh.position.set(lastSnapTarget.x, lastSnapTarget.planeY + 0.015, lastSnapTarget.z);
                    } else {
                        snapPreviewMesh.visible = false;
                    }
                }
            } else {
                lastSnapTarget = null;
                if (snapPreviewMesh) snapPreviewMesh.visible = false;
                if (hoverAuraGroup && hoverRay) {
                    hoverRay.setFromCamera(hoverCenter, camera);
                    const hits = interactiveMeshes.length ? hoverRay.intersectObjects(interactiveMeshes, false) : [];
                    let target = null;
                    if (hits.length && hits[0].distance < 7.5) {
                        const hObj = hits[0].object;
                        target = hObj.userData.pickRoot || (hObj.userData.isPickable ? hObj : (hObj.userData.equipId === 'porta' ? roomDoorPivot : null));
                    }
                    if (target) {
                        hoverBox.setFromObject(target);
                        hoverBox.getSize(hoverSize);
                        hoverBox.getCenter(hoverPos);
                        hoverAuraGroup.position.copy(hoverPos);
                        hoverAuraGroup.scale.set(hoverSize.x + 0.05, hoverSize.y + 0.05, hoverSize.z + 0.05);
                        const pulse = 0.5 + 0.5 * Math.sin(simTime * 5.2);
                        hoverAuraMat.opacity = 0.11 + pulse * 0.09;
                        hoverEdgeMat.opacity = 0.42 + pulse * 0.36;
                        hoverAuraGroup.visible = true;
                    } else {
                        hoverAuraGroup.visible = false;
                    }
                }
            }

            if (heldRock && hoverAuraGroup) hoverAuraGroup.visible = false;

            if (typeof window.onTwinDoorHint === 'function') {
                const dPorta = Math.hypot(cam.fpsX - 2.25, cam.fpsZ - 2.45);
                window.onTwinDoorHint(dPorta < 2.6, roomDoorOpen);
            }
        } else {
            if (fpsHandsGroup) fpsHandsGroup.visible = false;
            if (snapPreviewMesh) snapPreviewMesh.visible = false;
            if (hoverAuraGroup) hoverAuraGroup.visible = false;
            if (cam.autoRotate && !cam.dragging) cam.targetTheta += 0.003;
            cam.theta += (cam.targetTheta - cam.theta) * 0.12;
            cam.phi += (cam.targetPhi - cam.phi) * 0.12;
            cam.radius += (cam.targetRadius - cam.radius) * 0.12;
            cam.lookX += (cam.targetLookX - cam.lookX) * 0.12;
            cam.lookY += (cam.targetLookY - cam.lookY) * 0.12;
            cam.lookZ += (cam.targetLookZ - cam.lookZ) * 0.12;

            const showExteriorCabin = cam.radius > 10.5;
            if (frontWallGroup) frontWallGroup.visible = showExteriorCabin;
            if (cabinRoofGroup) cabinRoofGroup.visible = showExteriorCabin;

            camera.position.set(
                cam.lookX + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
                cam.lookY + cam.radius * Math.cos(cam.phi),
                cam.lookZ + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta)
            );
            camera.lookAt(cam.lookX, cam.lookY, cam.lookZ);
        }

        // Física de queda dos itens e pedras soltas (com pouso em prateleira ou chão)
        for (let i = fallingRocks.length - 1; i >= 0; i--) {
            const r = fallingRocks[i];
            const prevY = r.position.y;
            r.userData.velY = (r.userData.velY || 0) - 0.012;
            r.position.y += r.userData.velY;
            const halfH = r.userData.halfH || 0;
            let floorY = Math.max(-0.26, getGroundHeight(r.position.x, r.position.z)) + halfH;
            let landedShelf = null;

            if (!r.userData.isShelf) {
                for (let s = 0; s < shelfUnits.length; s++) {
                    const sh = shelfUnits[s];
                    if (!sh || sh === r || sh === heldRock || !sh.userData.shelfLevels) continue;
                    const dx = r.position.x - sh.position.x, dz = r.position.z - sh.position.z;
                    const cosY = Math.cos(-sh.rotation.y), sinY = Math.sin(-sh.rotation.y);
                    const lx = dx * cosY - dz * sinY, lz = dx * sinY + dz * cosY;
                    if (Math.abs(lx) <= (sh.userData.halfW || 0.45) && Math.abs(lz) <= (sh.userData.halfD || 0.25)) {
                        for (let l = 0; l < sh.userData.shelfLevels.length; l++) {
                            const sy = sh.position.y + sh.userData.shelfLevels[l] + halfH;
                            if (prevY >= sy - 0.02 && sy > floorY) {
                                floorY = sy;
                                landedShelf = sh;
                            }
                        }
                    }
                }
            }

            if (r.position.y <= floorY) {
                r.position.y = floorY;
                r.userData.velY = 0;
                r.userData.supportedBy = landedShelf;
                if (typeof r.userData.itemIndex === 'number') {
                    pendingDroppedItems.push({
                        id: r.userData.itemIndex,
                        x: r.position.x,
                        y: r.position.y,
                        z: r.position.z,
                        ry: r.rotation.y
                    });
                }
                fallingRocks.splice(i, 1);
            }
        }

        // Animação suave da porta da casa + marolas da lagoa + névoa
        if (roomDoorPivot) {
            const targetAng = roomDoorOpen ? 1.48 : 0.0;
            roomDoorAngle += (targetAng - roomDoorAngle) * 0.14;
            roomDoorPivot.rotation.y = roomDoorAngle;
        }
        if (waterTexRef) {
            waterTexRef.offset.x = (simTime * 0.015) % 1;
            waterTexRef.offset.y = (simTime * 0.010) % 1;
        }
        for (let m = 0; m < lakeMists.length; m++) {
            const lm = lakeMists[m];
            lm.mesh.position.x = lm.baseX + Math.sin(simTime * 0.18 + lm.phase) * 4.5;
        }

        const wetness = Math.max(0, Math.min(1, (state.humInt - 75) / 22));
        if (mylarMatRef) {
            mylarMatRef.roughness = 0.26 - wetness * 0.18;
            mylarMatRef.metalness = 0.84 + wetness * 0.12;
            const targetEmissive = state.luz ? (0.06 + wetness * 0.05) : 0.0;
            mylarMatRef.emissiveIntensity += (targetEmissive - mylarMatRef.emissiveIntensity) * 0.10;
        }
        if (trayMatRef) {
            trayMatRef.roughness = 0.34 - wetness * 0.22;
        }

        ledLight.intensity += ((state.luz ? 1.15 : 0.0) - ledLight.intensity) * 0.12;
        ledBarMat.emissiveIntensity = state.luz ? 0.95 : 0.05;
        if (ledConeMat) {
            const targetConeOp = state.luz ? (0.075 + wetness * 0.035 + Math.sin(simTime * 2.1) * 0.006) : 0.0;
            ledConeMat.opacity += (targetConeOp - ledConeMat.opacity) * 0.12;
        }
        ambientLight.intensity += ((state.luz ? 0.48 : 0.56) - ambientLight.intensity) * 0.08;
        acVaneMat.emissiveIntensity = state.ar ? 0.85 : 0.05;
        acLedMat.color.setHex(state.ar ? 0x38bdf8 : 0x475569);
        if (acVanePivot) {
            const targetAngle = state.ar ? (0.45 + Math.sin(simTime * 1.4) * 0.22) : 0.0;
            acVanePivot.rotation.z += (targetAngle - acVanePivot.rotation.z) * 0.08;
        }
        if (espHeartbeatMat) {
            const blink = ((simTime * 1.6) % 1.0) < 0.22;
            espHeartbeatMat.color.setHex(blink ? 0x38bdf8 : 0x0f172a);
        }
        if (relayLedMats.luz) relayLedMats.luz.color.setHex(state.luz ? 0xfacc15 : 0x334155);
        if (relayLedMats.umid) relayLedMats.umid.color.setHex(state.umid ? 0x38bdf8 : 0x334155);
        if (relayLedMats.vento) relayLedMats.vento.color.setHex(state.vento ? 0x34d399 : 0x334155);
        if (relayLedMats.exaust) relayLedMats.exaust.color.setHex(state.exaust ? 0x22d3ee : 0x334155);
        if (relayLedMats.ar) relayLedMats.ar.color.setHex(state.ar ? 0x60a5fa : 0x334155);
        if (roomThermDisplay) roomThermDisplay.update('QUARTO', state.tempExt, state.ar ? '❄️ AC Ligado' : '🌡️ Ambiente');
        if (tentThermDisplay) tentThermDisplay.update('ESTUFA', state.tempInt, `💧 UR ${state.humInt.toFixed(0)}%`);

        if (state.vento && ventoHelice) ventoHelice.rotation.x += 0.42;
        if (state.exaust && exaustHelice) exaustHelice.rotation.y += 0.46;

        // Animação contínua de flush dos cogumelos (pinagem -> crescimento -> colheita -> reinício)
        const flushCycle = (simTime * 0.055) % 1.0;
        for (let i = 0; i < mushrooms.length; i++) {
            const m = mushrooms[i];
            const t = (flushCycle - m.delay + 1.0) % 1.0;
            let sc = 0.001;
            if (t < 0.55) {
                // Nascendo e crescendo suavemente
                const u = t / 0.55;
                sc = (u * u * (3 - 2 * u)) * m.maxScale;
            } else if (t < 0.80) {
                // Maduro
                sc = m.maxScale;
            } else if (t < 0.92) {
                // Colheita / sumindo
                const u = 1.0 - (t - 0.80) / 0.12;
                sc = Math.max(0.001, u * m.maxScale);
            }
            m.mesh.visible = sc > 0.02;
            m.mesh.scale.set(sc, sc * 1.12, sc);
        }

        if (streamlinesGroup && streamlinesGroup.visible) {
            const up = new THREE.Vector3(0, 1, 0);
            for (let i = 0; i < flowArrows.length; i++) {
                const fa = flowArrows[i];
                const ativo = (fa.key === 'ar' && state.ar)
                    || (fa.key === 'exaust' && (state.exaust || state.vento))
                    || (fa.key === 'duct' && (state.exaust || state.vento || state.umid))
                    || (fa.key === 'umid' && state.umid);
                const mult = ativo ? 1.0 : 0.22;
                const t = (fa.offset + simTime * fa.speed * mult) % 1.0;
                const pt = fa.curve.getPointAt(t);
                const tan = fa.curve.getTangentAt(t).normalize();
                fa.mesh.position.copy(pt);
                fa.mesh.quaternion.setFromUnitVectors(up, tan);
                const sc = ativo ? 1.15 : 0.75;
                fa.mesh.scale.set(sc, sc, sc);
            }
        }

        if (airPoints && airPoints.material) {
            airPoints.material.size = cam.mode === 'fps' ? 0.08 : 0.11;
            airPoints.material.opacity = cam.mode === 'fps' ? 0.36 : 0.48;
        }
        stepMultiplayerAvatars();
        stepFluidPhysics();
        renderer.render(scene, camera);
    }

    const remotePlayers = {};

    function createNameTagSprite(text) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 64;
        const g = c.getContext('2d');
        g.fillStyle = 'rgba(15, 23, 42, 0.82)';
        g.beginPath();
        g.roundRect(16, 10, 224, 42, 18);
        g.fill();
        g.strokeStyle = 'rgba(52, 211, 153, 0.65)';
        g.lineWidth = 3;
        g.stroke();
        g.fillStyle = '#f8fafc';
        g.font = 'bold 24px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 128, 32);
        const tex = new THREE.CanvasTexture(c);
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
        const sp = new THREE.Sprite(mat);
        sp.scale.set(1.15, 0.28, 1);
        return sp;
    }

    function buildCuteAvatar(colorHex, hatHex, name) {
        const g = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.65 });
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde6d8, roughness: 0.7 });
        const hatMat = new THREE.MeshStandardMaterial({ color: hatHex, roughness: 0.55 });
        const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
        const darkMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
        const blushMat = new THREE.MeshBasicMaterial({ color: 0xfb7185 });

        // Perninhas
        const legGeo = new THREE.CylinderGeometry(0.065, 0.06, 0.42, 10);
        const legL = new THREE.Group();
        legL.position.set(-0.09, 0.42, 0);
        const legLM = new THREE.Mesh(legGeo, darkMat);
        legLM.position.y = -0.21;
        legL.add(legLM);
        g.add(legL);

        const legR = new THREE.Group();
        legR.position.set(0.09, 0.42, 0);
        const legRM = new THREE.Mesh(legGeo, darkMat);
        legRM.position.y = -0.21;
        legR.add(legRM);
        g.add(legR);

        // Corpinho fofinho (moletom)
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.48, 14), bodyMat);
        torso.position.y = 0.66;
        torso.castShadow = true;
        g.add(torso);

        // Bracinhos
        const armGeo = new THREE.CylinderGeometry(0.055, 0.05, 0.36, 10);
        const armL = new THREE.Group();
        armL.position.set(-0.23, 0.84, 0);
        const armLM = new THREE.Mesh(armGeo, bodyMat);
        armLM.position.y = -0.15;
        armL.add(armLM);
        g.add(armL);

        const armR = new THREE.Group();
        armR.position.set(0.23, 0.84, 0);
        const armRM = new THREE.Mesh(armGeo, bodyMat);
        armRM.position.y = -0.15;
        armR.add(armRM);
        g.add(armR);

        // Pivô da cabeça no pescoço para acompanhar a câmera (olhar para cima/baixo)
        const headPivot = new THREE.Group();
        headPivot.position.set(0, 0.96, 0);
        g.add(headPivot);

        // Cabeça chibi redondinha
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 14), skinMat);
        head.position.y = 0.14;
        head.castShadow = true;
        headPivot.add(head);

        // Olhinhos e bochechas rosadas (frente em -Z para combinar com yaw do FPS)
        [-0.075, 0.075].forEach(ex => {
            const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 8), darkMat);
            eye.position.set(ex, 0.15, -0.185);
            headPivot.add(eye);
            const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), blushMat);
            cheek.position.set(ex * 1.45, 0.10, -0.175);
            cheek.scale.set(1.2, 0.7, 0.5);
            headPivot.add(cheek);
        });

        // Chapéu fofo de cogumelo com pintinhas brancas!
        const cap = new THREE.Mesh(
            new THREE.SphereGeometry(0.30, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
            hatMat
        );
        cap.position.y = 0.26;
        cap.castShadow = true;
        headPivot.add(cap);
        [
            [0.14, 0.42, -0.12],
            [-0.15, 0.40, -0.10],
            [0.0, 0.47, 0.14],
            [-0.12, 0.39, 0.16],
            [0.16, 0.38, 0.12]
        ].forEach(([sx, sy, sz]) => {
            const spot = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), whiteMat);
            spot.position.set(sx, sy, sz);
            headPivot.add(spot);
        });

        // Tag com nome flutuante
        const tag = createNameTagSprite(name || 'Visitante');
        tag.position.y = 1.72;
        g.add(tag);

        return { group: g, headPivot, armL, armR, legL, legR, phase: Math.random() * 6 };
    }

    function stepMultiplayerAvatars() {
        if (!scene) return;
        const keys = Object.keys(remotePlayers);
        for (let i = 0; i < keys.length; i++) {
            const rp = remotePlayers[keys[i]];
            // Interpolação direta até a posição real recebida (sem predição oscilatória)
            const distErr = Math.hypot(rp.tx - rp.group.position.x, rp.tz - rp.group.position.z);
            if (distErr > 12) {
                rp.group.position.set(rp.tx, rp.ty, rp.tz);
            } else {
                rp.group.position.x += (rp.tx - rp.group.position.x) * 0.16;
                rp.group.position.y += (rp.ty - rp.group.position.y) * 0.18;
                rp.group.position.z += (rp.tz - rp.group.position.z) * 0.16;
            }

            // Interpolação angular suave (corpo no eixo Y, cabeça no eixo X)
            let dy = rp.tyaw - rp.group.rotation.y;
            while (dy > Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            rp.group.rotation.y += dy * 0.18;

            if (rp.headPivot) {
                const targetPitch = Math.max(-0.85, Math.min(0.85, rp.tpitch || 0));
                rp.headPivot.rotation.x += (targetPitch - rp.headPivot.rotation.x) * 0.20;
            }

            const holding = typeof rp.holdingRock === 'number' && rp.holdingRock >= 0 && pickableItems[rp.holdingRock];
            const isActuallyMoving = rp.walking || distErr > 0.045;
            if (isActuallyMoving) {
                const sw = Math.sin(simTime * 8.5 + rp.phase) * 0.62;
                rp.legL.rotation.x = sw;
                rp.legR.rotation.x = -sw;
                if (!holding) {
                    rp.armL.rotation.x = -sw * 0.68;
                    rp.armR.rotation.x = sw * 0.68;
                }
                rp.group.position.y += Math.abs(Math.sin(simTime * 8.5 + rp.phase)) * 0.025;
            } else {
                rp.legL.rotation.x *= 0.82;
                rp.legR.rotation.x *= 0.82;
                if (!holding) {
                    rp.armL.rotation.x *= 0.82;
                    rp.armR.rotation.x *= 0.82;
                }
            }

            if (holding) {
                rp.armL.rotation.x += (1.22 - rp.armL.rotation.x) * 0.25;
                rp.armR.rotation.x += (1.22 - rp.armR.rotation.x) * 0.25;
                rp.armL.rotation.z += (-0.18 - rp.armL.rotation.z) * 0.25;
                rp.armR.rotation.z += (0.18 - rp.armR.rotation.z) * 0.25;

                const rr = pickableItems[rp.holdingRock];
                if (rr && rr !== heldRock) {
                    const fwdX = -Math.sin(rp.group.rotation.y);
                    const fwdZ = -Math.cos(rp.group.rotation.y);
                    const distF = rr.userData.holdDist ? Math.min(1.75, rr.userData.holdDist * 0.85) : 1.05;
                    const rx = rp.group.position.x + fwdX * distF;
                    const ry = rp.group.position.y + 0.94 + Math.sin(simTime * 3.0 + rp.phase) * 0.03;
                    const rz = rp.group.position.z + fwdZ * distF;
                    rr.position.x += (rx - rr.position.x) * 0.28;
                    rr.position.y += (ry - rr.position.y) * 0.28;
                    rr.position.z += (rz - rr.position.z) * 0.28;
                    if (rr.userData.isPickableRock) {
                        rr.rotation.y += 0.018;
                    } else {
                        rr.rotation.y = rp.group.rotation.y;
                    }
                }
            } else {
                rp.armL.rotation.z *= 0.82;
                rp.armR.rotation.z *= 0.82;
            }
        }
    }

    window.initTwin3D = function (containerEl) {
        if (initialized || !containerEl) return;
        container = containerEl;
        if (typeof THREE === 'undefined') {
            container.innerHTML = '<div class="h-full flex items-center justify-center text-xs text-rose-300 p-6 text-center">Three.js não carregou.</div>';
            return;
        }
        initialized = true;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xbcd8eb);
        scene.fog = new THREE.FogExp2(0xc4ddf0, 0.0014);

        const w = container.clientWidth || 640, h = container.clientHeight || 420;
        camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 1400);

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        ambientLight = new THREE.AmbientLight(0xffffff, 0.52);
        scene.add(ambientLight);
        const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x2d4a3e, 0.58);
        scene.add(hemiLight);

        snapPreviewMesh = new THREE.Mesh(
            new THREE.RingGeometry(0.14, 0.19, 24),
            new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
        );
        snapPreviewMesh.rotation.x = -Math.PI / 2;
        snapPreviewMesh.visible = false;
        scene.add(snapPreviewMesh);

        hoverRay = new THREE.Raycaster();
        hoverCenter = new THREE.Vector2(0, 0);
        hoverBox = new THREE.Box3();
        hoverSize = new THREE.Vector3();
        hoverPos = new THREE.Vector3();
        hoverAuraGroup = new THREE.Group();
        hoverAuraMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.15, depthWrite: false });
        const auraBoxGeo = new THREE.BoxGeometry(1, 1, 1);
        hoverAuraGroup.add(new THREE.Mesh(auraBoxGeo, hoverAuraMat));
        hoverEdgeMat = new THREE.LineBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.6 });
        hoverAuraGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(auraBoxGeo), hoverEdgeMat));
        hoverAuraGroup.visible = false;
        scene.add(hoverAuraGroup);

        const keyLight = new THREE.DirectionalLight(0xfff1d6, 1.28);
        keyLight.position.set(32, 42, -55);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.left = -28;
        keyLight.shadow.camera.right = 28;
        keyLight.shadow.camera.top = 28;
        keyLight.shadow.camera.bottom = -28;
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = 160;
        keyLight.shadow.bias = -0.0006;
        scene.add(keyLight);

        const fillLight = new THREE.DirectionalLight(0xbae6fd, 0.35);
        fillLight.position.set(-14, 10, 18);
        scene.add(fillLight);

        scene.add(buildWorld());
        scene.add(buildCabinExterior());
        scene.add(buildRoom());
        scene.add(buildTent());
        scene.add(buildStreamlines());
        buildFpsHands();
        scene.add(camera);
        buildFluids(createFluidTexture());
        bindControls(renderer.domElement);
        animate();
    };

    window.updateTwin3DState = function (s) {
        if (!s) return;
        if (s.tempInt !== undefined) state.tempInt = Number(s.tempInt);
        if (s.tempExt !== undefined) state.tempExt = Number(s.tempExt);
        if (s.humInt !== undefined) state.humInt = Number(s.humInt);
        state.luz = !!s.luz;
        state.umid = !!s.umid;
        state.vento = !!s.vento;
        state.exaust = !!s.exaust;
        state.ar = !!s.ar;
    };

    window.setTwinCameraPreset = function (preset) {
        cam.mode = 'orbit';
        if (frontWallGroup) frontWallGroup.visible = false;
        cam.targetLookX = 0.15; cam.targetLookY = 1.22; cam.targetLookZ = -0.35;
        if (preset === 'frente') { cam.targetTheta = 0.05; cam.targetPhi = 1.22; cam.targetRadius = 5.4; }
        else if (preset === 'topo') { cam.targetTheta = 0.35; cam.targetPhi = 0.55; cam.targetRadius = 6.2; }
        else if (preset === 'interior') {
            cam.targetLookX = GX; cam.targetLookY = 1.08; cam.targetLookZ = GZ;
            cam.targetTheta = -0.05; cam.targetPhi = 1.30; cam.targetRadius = 3.0;
        }
        else if (preset === 'esp32') {
            cam.targetLookX = 0.58; cam.targetLookY = 1.04; cam.targetLookZ = -0.31;
            cam.targetTheta = -0.95; cam.targetPhi = 1.35; cam.targetRadius = 1.35;
        }
        else if (preset === 'cogumelos') {
            cam.targetLookX = GX; cam.targetLookY = 0.98; cam.targetLookZ = GZ - 0.08;
            cam.targetTheta = 0.12; cam.targetPhi = 1.26; cam.targetRadius = 1.85;
        }
        else if (preset === 'ar') {
            cam.targetLookX = -2.35; cam.targetLookY = 2.70; cam.targetLookZ = -0.35;
            cam.targetTheta = 0.72; cam.targetPhi = 1.32; cam.targetRadius = 2.2;
        }
        else if (preset === 'umid') {
            cam.targetLookX = 0.87; cam.targetLookY = 1.55; cam.targetLookZ = -0.55;
            cam.targetTheta = -0.35; cam.targetPhi = 1.25; cam.targetRadius = 1.9;
        }
        else if (preset === 'exaust') {
            cam.targetLookX = GX + 0.05; cam.targetLookY = H; cam.targetLookZ = GZ - 0.2;
            cam.targetTheta = 0.25; cam.targetPhi = 0.95; cam.targetRadius = 2.1;
        }
        else if (preset === 'vento') {
            cam.targetLookX = GX + halfW - 0.18; cam.targetLookY = 1.92; cam.targetLookZ = GZ + 0.1;
            cam.targetTheta = -0.45; cam.targetPhi = 1.22; cam.targetRadius = 1.9;
        }
        else if (preset === 'luz') {
            cam.targetLookX = GX - 0.15; cam.targetLookY = H - 0.15; cam.targetLookZ = GZ - 0.1;
            cam.targetTheta = 0.15; cam.targetPhi = 1.35; cam.targetRadius = 2.1;
        }
        else { cam.targetTheta = 0.35; cam.targetPhi = 1.15; cam.targetRadius = 6.4; }
    };

    window.focusTwinEquipment = function (equipId) {
        window.setTwinCameraPreset(equipId || 'default');
    };

    window.toggleTwinStreamlines = function () {
        showStreamlines = !showStreamlines;
        if (streamlinesGroup) streamlinesGroup.visible = showStreamlines;
        return showStreamlines;
    };

    window.toggleTwinDoor = function () {
        roomDoorOpen = !roomDoorOpen;
        return roomDoorOpen;
    };

    window.setTwinFpsMode = function (ativo) {
        cam.mode = ativo ? 'fps' : 'orbit';
        if (frontWallGroup) frontWallGroup.visible = !!ativo;
        if (cabinRoofGroup) cabinRoofGroup.visible = !!ativo;
        cam.keys = { w: false, s: false, a: false, d: false, shift: false, lookL: false, lookR: false, lookU: false, lookD: false };
        cam.joyX = 0;
        cam.joyY = 0;
        cam.fpsMoving = false;
        if (ativo) {
            cam.fpsX = 1.15; cam.fpsY = 1.62; cam.fpsZ = 1.85;
            cam.fpsYaw = 0.42; cam.fpsPitch = -0.05;
        } else {
            if (heldRock) {
                heldRock.userData.velY = 0;
                fallingRocks.push(heldRock);
                heldRock = null;
                if (typeof window.onTwinHeldChange === 'function') window.onTwinHeldChange(false);
            }
            if (document.pointerLockElement && document.exitPointerLock) {
                try { document.exitPointerLock(); } catch (e) {}
            }
        }
        return cam.mode === 'fps';
    };

    window.setTwinFpsKey = function (k, pressed) {
        if (k in cam.keys) cam.keys[k] = !!pressed;
    };

    function buildFpsHands() {
        fpsHandsGroup = new THREE.Group();
        fpsHandsGroup.visible = false;
        const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.7 });
        const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde6d8, roughness: 0.65 });

        function makeArm() {
            const g = new THREE.Group();
            const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.24, 10), sleeveMat);
            sleeve.rotation.x = Math.PI / 2;
            sleeve.position.z = 0.08;
            g.add(sleeve);
            const hand = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), skinMat);
            hand.scale.set(0.95, 0.85, 1.2);
            hand.position.z = -0.05;
            g.add(hand);
            return g;
        }
        fpsHandL = makeArm();
        fpsHandL.position.set(-0.28, -0.24, -0.40);
        fpsHandR = makeArm();
        fpsHandR.position.set(0.28, -0.24, -0.40);
        fpsHandsGroup.add(fpsHandL);
        fpsHandsGroup.add(fpsHandR);
        camera.add(fpsHandsGroup);
    }

    window.rotateTwinHeldItem = function (dir) {
        if (heldRock) {
            heldYawOffset += (dir || 1) * (Math.PI / 12);
        }
    };

    window.triggerTwinJump = function () {
        if (cam.mode === 'fps' && cam.fpsGrounded) {
            cam.fpsVelY = 0.175;
            cam.fpsGrounded = false;
        }
    };

    window.setTwinJoystick = function (jx, jy) {
        cam.joyX = Math.max(-1, Math.min(1, Number(jx) || 0));
        cam.joyY = Math.max(-1, Math.min(1, Number(jy) || 0));
    };

    window.toggleTwinAutoRotate = function () {
        cam.autoRotate = !cam.autoRotate;
        return cam.autoRotate;
    };

    window.resetTwinCamera = function () {
        window.setTwinCameraPreset('default');
    };

    window.consumeTwinDroppedRock = function () {
        pendingDroppedRock = null;
        pendingDroppedItems.length = 0;
    };

    window.resetTwinWorldObjects = function () {
        heldRock = null;
        lastSnapTarget = null;
        pendingDroppedRock = null;
        pendingDroppedItems.length = 0;
        fallingRocks.length = 0;
        if (snapPreviewMesh) snapPreviewMesh.visible = false;
        if (hoverAuraGroup) hoverAuraGroup.visible = false;
        for (let i = 0; i < pickableItems.length; i++) {
            const it = pickableItems[i];
            if (!it || !it.userData.homePos) continue;
            it.position.copy(it.userData.homePos);
            it.rotation.y = it.userData.homeRotY || 0;
            it.userData.supportedBy = it.userData.homeSupportedBy || null;
            it.userData.velY = 0;
        }
    };

    window.getTwinPlayerPose = function () {
        const walking = cam.mode === 'fps' && !!cam.fpsMoving;
        const holdingRock = (heldRock && typeof heldRock.userData.itemIndex === 'number') ? heldRock.userData.itemIndex : -1;
        const droppedItems = pendingDroppedItems.length ? pendingDroppedItems.slice() : null;
        if (cam.mode === 'fps') {
            return {
                x: cam.fpsX,
                y: Math.max(0, getGroundHeight(cam.fpsX, cam.fpsZ), cam.fpsY - 1.62),
                z: cam.fpsZ,
                yaw: cam.fpsYaw,
                pitch: cam.fpsPitch,
                holdingRock,
                droppedItems,
                walking,
                inFps: true
            };
        }
        return { x: 1.15, y: 0.02, z: 3.45, yaw: 0.25, pitch: 0, holdingRock: -1, droppedItems, walking: false, inFps: false };
    };

    window.updateMultiplayerPlayers = function (list, worldRocks) {
        if (!scene || !Array.isArray(list)) return;
        const activeIds = {};
        const heldByOthers = {};
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (!p || !p.id) continue;
            activeIds[p.id] = true;
            const hr = typeof p.holdingRock === 'number' ? p.holdingRock : -1;
            if (hr >= 0) heldByOthers[hr] = true;
            if (!remotePlayers[p.id]) {
                const av = buildCuteAvatar(p.color || 0x38bdf8, p.hatColor || 0xe11d48, p.name || 'Visitante');
                av.group.position.set(p.x || 1.15, p.y || 0.02, p.z || 3.45);
                av.group.rotation.y = p.yaw || 0;
                if (av.headPivot) {
                    av.headPivot.rotation.x = Math.max(-0.85, Math.min(0.85, p.pitch || 0));
                }
                scene.add(av.group);
                remotePlayers[p.id] = {
                    ...av,
                    tx: p.x || 1.15,
                    ty: p.y || 0.02,
                    tz: p.z || 3.45,
                    vx: 0,
                    vz: 0,
                    tyaw: p.yaw || 0,
                    tpitch: p.pitch || 0,
                    holdingRock: hr,
                    walking: !!p.walking
                };
            } else {
                const rp = remotePlayers[p.id];
                rp.tx = p.x;
                rp.ty = p.y;
                rp.tz = p.z;
                rp.tyaw = p.yaw;
                rp.tpitch = p.pitch || 0;
                rp.holdingRock = hr;
                rp.walking = !!p.walking;
            }
        }
        // Sincroniza itens e pedras soltas no mapa que não estão na mão de ninguém
        if (worldRocks && typeof worldRocks === 'object') {
            Object.keys(worldRocks).forEach(k => {
                const idx = parseInt(k, 10);
                const pos = worldRocks[k];
                const rr = pickableItems[idx];
                if (!rr || !Array.isArray(pos) || pos.length < 3) return;
                if (rr === heldRock || heldByOthers[idx] || fallingRocks.indexOf(rr) !== -1) return;
                if (Math.hypot(rr.position.x - pos[0], rr.position.z - pos[2]) > 0.05 || Math.abs(rr.position.y - pos[1]) > 0.05) {
                    rr.position.set(pos[0], pos[1], pos[2]);
                    if (typeof pos[3] === 'number' && !rr.userData.isPickableRock) {
                        rr.rotation.y = pos[3];
                    }
                }
            });
        }
        // Remove imediatamente quem deslogou ou ficou inativo
        Object.keys(remotePlayers).forEach(id => {
            if (!activeIds[id]) {
                scene.remove(remotePlayers[id].group);
                delete remotePlayers[id];
            }
        });
    };
})();
