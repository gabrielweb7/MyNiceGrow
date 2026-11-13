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

    let ledBarMat, ledLight, ambientLight;
    let ventoHelice, exaustHelice;
    let acVaneMat, acLedMat;

    // Partículas persistentes DENTRO da estufa (conservação de massa, nunca somem)
    const GROW_COUNT = 280;
    let growPoints, growPos, growCol;
    const growParticles = [];

    // Partículas + Linhas de Fluxo CFD no QUARTO INTEIRO
    const ROOM_COUNT = 520;
    let roomPoints, roomPos, roomCol;
    let roomLines, roomLinePos, roomLineCol;
    const roomParticles = [];

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
        // Estado FPS (primeira pessoa dentro do quarto)
        fpsX: 0.45,
        fpsY: 1.65,
        fpsZ: 1.65,
        fpsYaw: 0.12,
        fpsPitch: -0.06,
        keys: { w: false, s: false, a: false, d: false },
        dragging: false,
        lastX: 0,
        lastY: 0,
        pinchDist: 0,
        autoRotate: false
    };

    // Dimensões da estufa (centrada em x = -0.35, z = -0.25)
    const GX = -0.35, GZ = -0.25;
    const W = 1.45, H = 2.35, D = 1.25;
    const halfW = W / 2, halfD = D / 2;

    function tempToRGB(t, isMist) {
        const clamped = Math.max(19.0, Math.min(31.0, t));
        let r, g, b;
        if (clamped <= 23.0) {
            const u = (clamped - 19.0) / 4.0;
            r = 0.12 + 0.08 * u; g = 0.55 + 0.32 * u; b = 1.0;
        } else if (clamped <= 26.0) {
            const u = (clamped - 23.0) / 3.0;
            r = 0.20 * (1 - u) + 0.16 * u; g = 0.87; b = 1.0 * (1 - u) + 0.48 * u;
        } else if (clamped <= 28.0) {
            const u = (clamped - 26.0) / 2.0;
            r = 0.16 + 0.82 * u; g = 0.87 - 0.12 * u; b = 0.48 * (1 - u) + 0.12 * u;
        } else {
            const u = (clamped - 28.0) / 3.0;
            r = 0.98; g = 0.75 - 0.50 * u; b = 0.12 + 0.14 * u;
        }
        if (isMist) {
            r = r * 0.55 + 0.45; g = g * 0.55 + 0.45; b = b * 0.55 + 0.45;
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

        // Piso cerâmico
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.8), floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0.3, 0, 0.3);
        room.add(floor);

        // Parede do fundo
        const backWall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), wallMat);
        backWall.position.set(0.3, 1.8, -2.1);
        room.add(backWall);

        // Parede esquerda (com janela e Split Inverter)
        const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.6), wallMat);
        leftWall.rotation.y = Math.PI / 2;
        leftWall.position.set(-2.6, 1.8, 0.3);
        room.add(leftWall);

        // Parede direita (fecha o quarto para o modo FPS)
        const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 3.6), wallMat);
        rightWall.rotation.y = -Math.PI / 2;
        rightWall.position.set(3.5, 1.8, 0.3);
        room.add(rightWall);

        // Parede frontal (atrás da câmera no modo órbita, visível no FPS) + Teto
        const frontWallMat = new THREE.MeshStandardMaterial({ color: 0xdbe2ea, roughness: 0.85, side: THREE.FrontSide });
        const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 3.6), frontWallMat);
        frontWall.rotation.y = Math.PI;
        frontWall.position.set(0.3, 1.8, 2.45);
        room.add(frontWall);

        const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 5.8), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.9, side: THREE.FrontSide }));
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(0.3, 3.48, 0.3);
        room.add(ceiling);

        // Porta do quarto na parede frontal direita
        const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.02, 2.22, 0.08), new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 }));
        doorFrame.position.set(2.25, 1.11, 2.42);
        room.add(doorFrame);
        const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.90, 2.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.6 }));
        doorLeaf.position.set(2.25, 1.07, 2.39);
        room.add(doorLeaf);
        const doorHandle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.8, roughness: 0.2 }));
        doorHandle.position.set(1.88, 1.05, 2.34);
        room.add(doorHandle);

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

        // Ar-Condicionado Split Inverter ACIMA DA JANELA
        const acBody = new THREE.Mesh(
            new THREE.BoxGeometry(0.34, 0.34, 1.18),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.28, metalness: 0.15 })
        );
        acBody.position.set(-2.42, 2.75, -0.35);
        room.add(acBody);

        acVaneMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, emissive: 0x38bdf8, emissiveIntensity: 0.05 });
        const acVane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.06), acVaneMat);
        acVane.position.set(-2.26, 2.60, -0.35);
        room.add(acVane);

        acLedMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
        const acLed = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.08), acLedMat);
        acLed.position.set(-2.24, 2.74, 0.12);
        room.add(acLed);

        // Estante preta de apoio à DIREITA da estufa (com Umidificador + mangueira amarela + frascos)
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
        const rx = 1.05, rz = -0.55;
        [0.12, 0.72, 1.32].forEach(sy => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.04, 0.55), shelfMat);
            p.position.set(rx, sy, rz);
            room.add(p);
        });
        [[-0.44, -0.24], [0.44, -0.24], [-0.44, 0.24], [0.44, 0.24]].forEach(([ox, oz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 8), shelfMat);
            leg.position.set(rx + ox, 0.73, rz + oz);
            room.add(leg);
        });

        // Umidificador azul no topo da estante preta
        const umidBase = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.19, 0.36, 16),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3, transparent: true, opacity: 0.88 })
        );
        umidBase.position.set(rx - 0.18, 1.52, rz);
        room.add(umidBase);

        // Mangueira amarela do umidificador entrando no topo da estufa
        const hoseMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 });
        const hoseCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(rx - 0.18, 1.72, rz),
            new THREE.Vector3(rx - 0.15, 2.25, rz + 0.05),
            new THREE.Vector3(GX + halfW + 0.05, 2.28, GZ + 0.15),
            new THREE.Vector3(GX + halfW - 0.12, 2.15, GZ + 0.15)
        ]);
        const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 18, 0.04, 10, false), hoseMat);
        room.add(hose);

        // Potes de vidro / frascos na estante
        const jarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.15, transparent: true, opacity: 0.65 });
        [0.12, 0.30].forEach(ox => {
            const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.18, 12), jarMat);
            jar.position.set(rx + ox, 1.43, rz + 0.05);
            room.add(jar);
            const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.3 }));
            bottle.position.set(rx + ox - 0.15, 0.85, rz);
            room.add(bottle);
        });

        // Estante aramada de SPAWNS mais à direita (como na 3ª foto!)
        const sx = 2.35, sz = -0.85;
        const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.85, roughness: 0.25 });
        const grainMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.75 });
        const subBagMat = new THREE.MeshStandardMaterial({ color: 0xa8a29e, roughness: 0.85 });
        [0.2, 0.75, 1.3, 1.85].forEach((sy, idx) => {
            const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.025, 0.52), chromeMat);
            p.position.set(sx, sy, sz);
            room.add(p);
            // Sacos de spawn dourados em cima
            const matSaco = idx >= 2 ? grainMat : subBagMat;
            for (let k = -2; k <= 2; k++) {
                const bag = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.24), matSaco);
                bag.position.set(sx + k * 0.21, sy + 0.145, sz);
                room.add(bag);
            }
        });
        [[-0.55, -0.24], [0.55, -0.24], [-0.55, 0.24], [0.55, 0.24]].forEach(([ox, oz]) => {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.0, 8), chromeMat);
            leg.position.set(sx + ox, 1.0, sz + oz);
            room.add(leg);
        });

        return room;
    }

    function buildTent() {
        const group = new THREE.Group();
        group.position.set(GX, 0, GZ);

        const blackMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.82, metalness: 0.1 });
        const mylarMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.28, metalness: 0.78, side: THREE.FrontSide });
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

        // Duto sanfonado prateado INFERIOR ESQUERDO (por onde o ar SAI para o quarto!)
        const ductMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.7 });
        const ductOut = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.42, 16), ductMat);
        ductOut.rotation.z = Math.PI / 2;
        ductOut.position.set(-halfW - 0.15, 0.16, 0.35);
        group.add(ductOut);

        // 2 estantes pretas internas com blocos de cogumelos (como na foto real!)
        const rackMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
        const subMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.85 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 });

        [-0.34, 0.34].forEach(rx => {
            [0.35, 0.92, 1.48].forEach(sy => {
                const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.025, 0.78), rackMat);
                shelf.position.set(rx, sy, -0.08);
                group.add(shelf);
                const block = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.56), subMat);
                block.position.set(rx, sy + 0.09, -0.08);
                group.add(block);
                for (let m = 0; m < 4; m++) {
                    const mz = -0.26 + m * 0.13;
                    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.015, 0.08, 8), stemMat);
                    stem.position.set(rx + (m % 2 === 0 ? 0.06 : -0.06), sy + 0.21, mz);
                    group.add(stem);
                    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
                    cap.position.set(rx + (m % 2 === 0 ? 0.06 : -0.06), sy + 0.245, mz);
                    group.add(cap);
                }
            });
        });

        // Barra LED no teto
        ledBarMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0xfef08a, emissiveIntensity: 0.05 });
        const ledBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.62, 0.04, 0.14), ledBarMat);
        ledBar.position.set(-0.15, H - 0.12, -0.1);
        group.add(ledBar);

        ledLight = new THREE.PointLight(0xfef9c3, 0, 4.5, 1.5);
        ledLight.position.set(-0.15, H - 0.22, -0.1);
        group.add(ledLight);

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

        return group;
    }

    function buildFluids(tex) {
        // 1. Fluido interno da estufa (partículas contínuas que nunca desaparecem)
        const gGeo = new THREE.BufferGeometry();
        growPos = new Float32Array(GROW_COUNT * 3);
        growCol = new Float32Array(GROW_COUNT * 3);
        for (let i = 0; i < GROW_COUNT; i++) {
            const p = {
                x: GX + (Math.random() - 0.5) * (W * 0.85),
                y: 0.15 + Math.random() * (H - 0.3),
                z: GZ + (Math.random() - 0.5) * (D * 0.82),
                vx: 0, vy: 0, vz: 0,
                temp: state.tempInt,
                mist: false
            };
            growParticles.push(p);
            growPos[i * 3] = p.x; growPos[i * 3 + 1] = p.y; growPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, false);
            growCol[i * 3] = r; growCol[i * 3 + 1] = g; growCol[i * 3 + 2] = b;
        }
        gGeo.setAttribute('position', new THREE.BufferAttribute(growPos, 3));
        gGeo.setAttribute('color', new THREE.BufferAttribute(growCol, 3));
        growPoints = new THREE.Points(gGeo, new THREE.PointsMaterial({
            size: 0.18,
            map: tex,
            vertexColors: true,
            transparent: true,
            opacity: 0.72,
            depthWrite: false
        }));
        scene.add(growPoints);

        // 2. Fluido no Quarto INTEIRO (convecção térmica real, jato/retorno do AC Split, janela e duto)
        const rGeo = new THREE.BufferGeometry();
        roomPos = new Float32Array(ROOM_COUNT * 3);
        roomCol = new Float32Array(ROOM_COUNT * 3);
        for (let i = 0; i < ROOM_COUNT; i++) {
            let rx = -2.45 + Math.random() * 5.6;
            let ry = 0.12 + Math.random() * 3.1;
            let rz = -1.95 + Math.random() * 3.8;
            // Evita nascer dentro da estufa
            if (rx > GX - halfW - 0.08 && rx < GX + halfW + 0.08 && rz > GZ - halfD - 0.08 && rz < GZ + halfD + 0.08 && ry < H + 0.05) {
                rx = 0.75 + Math.random() * 2.2;
            }
            const p = {
                x: rx, y: ry, z: rz,
                vx: (Math.random() - 0.5) * 0.008,
                vy: (Math.random() - 0.5) * 0.006,
                vz: (Math.random() - 0.5) * 0.008,
                temp: state.tempExt + (ry / 3.2 - 0.5) * 1.2
            };
            roomParticles.push(p);
            roomPos[i * 3] = p.x; roomPos[i * 3 + 1] = p.y; roomPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, false);
            roomCol[i * 3] = r; roomCol[i * 3 + 1] = g; roomCol[i * 3 + 2] = b;
        }
        rGeo.setAttribute('position', new THREE.BufferAttribute(roomPos, 3));
        rGeo.setAttribute('color', new THREE.BufferAttribute(roomCol, 3));
        roomPoints = new THREE.Points(rGeo, new THREE.PointsMaterial({
            size: 0.13,
            map: tex,
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        }));
        scene.add(roomPoints);

        // Linhas de fluxo CFD (mostram direção e velocidade real do ar no quarto!)
        const lGeo = new THREE.BufferGeometry();
        roomLinePos = new Float32Array(ROOM_COUNT * 6);
        roomLineCol = new Float32Array(ROOM_COUNT * 6);
        lGeo.setAttribute('position', new THREE.BufferAttribute(roomLinePos, 3));
        lGeo.setAttribute('color', new THREE.BufferAttribute(roomLineCol, 3));
        roomLines = new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.68
        }));
        scene.add(roomLines);
    }

    function stepFluidPhysics() {
        simTime += 0.025;
        const topHeatBonus = state.luz ? 1.1 : 0.0;

        growPoints.material.size += ((state.umid ? 0.25 : 0.16) - growPoints.material.size) * 0.08;

        for (let i = 0; i < GROW_COUNT; i++) {
            const p = growParticles[i];
            const lx = p.x - GX;
            const lz = p.z - GZ;

            // Turbulência curl contínua
            p.vx += Math.sin(p.y * 2.5 + simTime) * Math.cos(lz * 2.3 + simTime * 0.7) * 0.0014;
            p.vy += Math.sin(lx * 2.4 + simTime * 0.8) * 0.0010;
            p.vz += Math.cos(p.y * 2.3 - simTime) * Math.sin(lx * 2.5 + simTime * 0.6) * 0.0014;

            // Empuxo térmico suave (evita acumular tudo no teto quando vento está desligado)
            p.vy += (p.temp - state.tempInt) * 0.00035;

            // Ventilador Interno (vórtice interno)
            if (state.vento) {
                const dist = Math.hypot(lx, lz) + 0.06;
                p.vx += (-lz / dist) * 0.0042;
                p.vz += (lx / dist) * 0.0042;
            }

            // Exaustor no TOPO empurra ar de cima para baixo, e o ar sai pelo duto INFERIOR ESQUERDO!
            if (state.exaust) {
                p.vy -= 0.0042; // Downwash de cima para baixo
                // Atrai em direção ao duto inferior esquerdo (-halfW, 0.16, 0.35)
                if (p.y < 0.75) {
                    const dx = (-halfW - 0.15) - lx;
                    const dy = 0.16 - p.y;
                    const dz = 0.35 - lz;
                    const d = Math.hypot(dx, dy, dz) + 0.15;
                    p.vx += (dx / d) * 0.0065;
                    p.vy += (dy / d) * 0.0055;
                    p.vz += (dz / d) * 0.0065;
                }
            }

            p.vx *= 0.95; p.vy *= 0.95; p.vz *= 0.95;
            p.x += p.vx; p.y += p.vy; p.z += p.vz;

            const localGoal = state.tempInt + (p.y > 1.8 ? topHeatBonus : 0);
            p.temp += (localGoal - p.temp) * 0.015;

            // Se saiu pelo duto inferior esquerdo (durante exaustão), entra ar novo pelo TOPO (conservação de massa!)
            if (state.exaust && (p.x - GX) < -halfW - 0.05 && p.y < 0.45) {
                p.x = GX + 0.05 + (Math.random() - 0.5) * 0.22;
                p.y = H - 0.15;
                p.z = GZ - 0.2 + (Math.random() - 0.5) * 0.22;
                p.vx = (Math.random() - 0.5) * 0.012;
                p.vy = -(0.025 + Math.random() * 0.015);
                p.vz = (Math.random() - 0.5) * 0.012;
                p.temp = state.tempExt;
                p.mist = false;
            } else {
                // Se umidificador ligado, parte das partículas reciclam na mangueira amarela (topo direito)
                if (state.umid && Math.random() < 0.015) {
                    p.x = GX + halfW - 0.12;
                    p.y = 2.12;
                    p.z = GZ + 0.15;
                    p.vx = -(0.015 + Math.random() * 0.01);
                    p.vy = -(0.012 + Math.random() * 0.01);
                    p.vz = (Math.random() - 0.5) * 0.012;
                    p.temp = state.tempInt - 0.7;
                    p.mist = true;
                }
                // Colisão suave nas paredes internas (partícula NUNCA some!)
                if (p.x < GX - halfW + 0.06) { p.x = GX - halfW + 0.06; p.vx *= -0.6; }
                if (p.x > GX + halfW - 0.06) { p.x = GX + halfW - 0.06; p.vx *= -0.6; }
                if (p.z < GZ - halfD + 0.06) { p.z = GZ - halfD + 0.06; p.vz *= -0.6; }
                if (p.z > GZ + halfD - 0.06) { p.z = GZ + halfD - 0.06; p.vz *= -0.6; }
                if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.45; }
                if (p.y > H - 0.08) { p.y = H - 0.08; p.vy *= -0.45; }
            }

            growPos[i * 3] = p.x; growPos[i * 3 + 1] = p.y; growPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, p.mist && state.umid);
            growCol[i * 3] = r; growCol[i * 3 + 1] = g; growCol[i * 3 + 2] = b;
        }
        growPoints.geometry.attributes.position.needsUpdate = true;
        growPoints.geometry.attributes.color.needsUpdate = true;

        // ============================================================
        // FÍSICA REAL DO AR DENTRO DO QUARTO INTEIRO
        // ============================================================
        // Campo de convecção, jato + retorno do AC Split, calor da janela,
        // sucção no topo da estufa e descarga pelo duto inferior esquerdo.
        const acColdTemp = Math.min(20.5, state.tempExt - 4.0);
        const topExX = GX + 0.05, topExY = H + 0.15, topExZ = GZ - 0.20;
        const ductOutX = GX - halfW - 0.36, ductOutY = 0.16, ductOutZ = GZ + 0.35;

        for (let i = 0; i < ROOM_COUNT; i++) {
            const p = roomParticles[i];

            // 1. Turbulência curl 3D no volume do quarto (mantém o ar distribuído em 3D)
            p.vx += Math.sin(p.y * 1.4 + simTime * 0.9) * Math.cos(p.z * 1.2 + simTime * 0.6) * 0.0014;
            p.vy += Math.sin(p.x * 1.1 + simTime * 0.7) * Math.cos(p.z * 1.1 + simTime * 0.5) * 0.0011;
            p.vz += Math.cos(p.y * 1.3 - simTime * 0.8) * Math.sin(p.x * 1.2 + simTime * 0.5) * 0.0014;

            // 2. Empuxo térmico relativo à média local (não cola tudo no chão!)
            const refTempY = state.tempExt + (p.y / 3.4 - 0.5) * 0.4;
            p.vy += (p.temp - refTempY) * 0.00045;

            // 3. Fonte térmica da janela (condução leve na parede esquerda)
            if (p.x < -2.0 && p.y > 0.8 && p.y < 2.3 && Math.abs(p.z + 0.35) < 0.9) {
                p.temp += ((state.tempExt + 1.2) - p.temp) * 0.015;
            }

            // 4. Ar-Condicionado Split Inverter (acima da janela: x=-2.26, y=2.60, z=-0.35)
            if (state.ar) {
                // Jato frio saindo da aleta inferior do Split para o quarto
                if (p.x > -2.35 && p.x < -0.4 && p.y > 1.75 && p.y < 2.75 && Math.abs(p.z + 0.35) < 0.75) {
                    const distJet = Math.max(0.2, p.x + 2.35);
                    const force = 0.0085 / (0.4 + distJet);
                    p.vx += force;
                    p.vy -= force * 0.42;
                    p.temp += (acColdTemp - p.temp) * 0.14;
                }
                // Sucção de retorno no topo do Split (fecha a célula de convecção do quarto!)
                const rx = -2.30 - p.x;
                const ry = 2.95 - p.y;
                const rz = -0.35 - p.z;
                const dRet = Math.hypot(rx, ry, rz) + 0.3;
                if (dRet < 2.6 && p.y > 2.2) {
                    const pull = 0.0045 / (0.5 + dRet);
                    p.vx += (rx / dRet) * pull;
                    p.vy += (ry / dRet) * pull;
                    p.vz += (rz / dRet) * pull;
                }
                // Ar que passa muito perto do retorno do AC é resfriado e soprado pela aleta
                if (p.x < -2.12 && p.y > 2.72 && Math.abs(p.z + 0.35) < 0.6) {
                    p.y = 2.58;
                    p.x = -2.22;
                    p.vx = 0.038;
                    p.vy = -0.016;
                    p.temp = acColdTemp;
                }
            }

            // 5. Troca de ar com a Estufa quando Exaustor está LIGADO
            if (state.exaust) {
                // Sucção do ar do quarto no TOPO da estufa
                const sx = topExX - p.x;
                const sy = topExY - p.y;
                const sz = topExZ - p.z;
                const dTop = Math.hypot(sx, sy, sz) + 0.2;
                if (dTop < 1.9 && p.y > 1.9) {
                    const pull = 0.0065 / (0.35 + dTop);
                    p.vx += (sx / dTop) * pull;
                    p.vy += (sy / dTop) * pull;
                    p.vz += (sz / dTop) * pull;
                }
                // Se entrou na boca do exaustor no topo -> atravessa a estufa e sai pelo duto inferior esquerdo!
                if (dTop < 0.38) {
                    p.x = ductOutX;
                    p.y = ductOutY + (Math.random() - 0.5) * 0.08;
                    p.z = ductOutZ + (Math.random() - 0.5) * 0.10;
                    p.vx = -(0.032 + Math.random() * 0.012);
                    p.vy = 0.004;
                    p.vz = (Math.random() - 0.5) * 0.008;
                    p.temp = state.tempInt;
                }
            }

            // Difusão térmica natural com o ambiente do quarto
            const goalRoom = state.ar ? (state.tempExt - 1.5 + (p.y / 3.4) * 1.4) : (state.tempExt + (p.y / 3.4 - 0.5) * 0.8);
            p.temp += (goalRoom - p.temp) * 0.008;

            p.vx *= 0.96; p.vy *= 0.96; p.vz *= 0.96;
            p.x += p.vx; p.y += p.vy; p.z += p.vz;

            // Colisão com paredes, piso e teto do quarto
            if (p.x < -2.52) { p.x = -2.52; p.vx *= -0.55; }
            if (p.x > 3.40) { p.x = 3.40; p.vx *= -0.55; }
            if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.45; }
            if (p.y > 3.35) { p.y = 3.35; p.vy *= -0.45; }
            if (p.z < -2.02) { p.z = -2.02; p.vz *= -0.55; }
            if (p.z > 2.20) { p.z = 2.20; p.vz *= -0.55; }

            // Deflexão ao redor do volume sólido da Estufa (ar do quarto contorna a tenda!)
            const minTX = GX - halfW - 0.06, maxTX = GX + halfW + 0.06;
            const minTZ = GZ - halfD - 0.06, maxTZ = GZ + halfD + 0.06;
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

            roomPos[i * 3] = p.x; roomPos[i * 3 + 1] = p.y; roomPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, false);
            roomCol[i * 3] = r; roomCol[i * 3 + 1] = g; roomCol[i * 3 + 2] = b;

            // Vetor de linha de fluxo (cauda proporcional à velocidade real)
            const tail = 5.5;
            roomLinePos[i * 6] = p.x;
            roomLinePos[i * 6 + 1] = p.y;
            roomLinePos[i * 6 + 2] = p.z;
            roomLinePos[i * 6 + 3] = p.x - p.vx * tail;
            roomLinePos[i * 6 + 4] = p.y - p.vy * tail;
            roomLinePos[i * 6 + 5] = p.z - p.vz * tail;
            roomLineCol[i * 6] = r; roomLineCol[i * 6 + 1] = g; roomLineCol[i * 6 + 2] = b;
            roomLineCol[i * 6 + 3] = r * 0.5; roomLineCol[i * 6 + 4] = g * 0.5; roomLineCol[i * 6 + 5] = b * 0.5;
        }
        roomPoints.geometry.attributes.position.needsUpdate = true;
        roomPoints.geometry.attributes.color.needsUpdate = true;
        roomLines.geometry.attributes.position.needsUpdate = true;
        roomLines.geometry.attributes.color.needsUpdate = true;
    }

    function bindControls(el) {
        el.addEventListener('pointerdown', (e) => {
            cam.dragging = true; cam.lastX = e.clientX; cam.lastY = e.clientY;
        });
        window.addEventListener('pointermove', (e) => {
            if (!cam.dragging) return;
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
        });
        window.addEventListener('pointerup', () => { cam.dragging = false; });

        window.addEventListener('keydown', (e) => {
            if (cam.mode !== 'fps') return;
            const k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') { cam.keys.w = true; e.preventDefault(); }
            if (k === 's' || e.key === 'ArrowDown') { cam.keys.s = true; e.preventDefault(); }
            if (k === 'a' || e.key === 'ArrowLeft') { cam.keys.a = true; e.preventDefault(); }
            if (k === 'd' || e.key === 'ArrowRight') { cam.keys.d = true; e.preventDefault(); }
        });
        window.addEventListener('keyup', (e) => {
            const k = e.key.toLowerCase();
            if (k === 'w' || e.key === 'ArrowUp') cam.keys.w = false;
            if (k === 's' || e.key === 'ArrowDown') cam.keys.s = false;
            if (k === 'a' || e.key === 'ArrowLeft') cam.keys.a = false;
            if (k === 'd' || e.key === 'ArrowRight') cam.keys.d = false;
        });

        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.targetRadius = Math.max(3.0, Math.min(9.5, cam.targetRadius + e.deltaY * 0.004));
        }, { passive: false });

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                cam.pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
            }
        }, { passive: true });
        el.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && cam.pinchDist > 0) {
                const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
                cam.targetRadius = Math.max(3.0, Math.min(9.5, cam.targetRadius - (dist - cam.pinchDist) * 0.01));
                cam.pinchDist = dist;
            }
        }, { passive: true });
        el.addEventListener('dblclick', () => window.resetTwinCamera());
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!renderer || !scene || !camera) return;

        const w = container.clientWidth, h = container.clientHeight;
        if (w > 0 && h > 0) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            if (renderer.domElement.width !== Math.floor(w * dpr) || renderer.domElement.height !== Math.floor(h * dpr)) {
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
            }
        }

        if (cam.mode === 'fps') {
            const speed = 0.048;
            const fwdX = -Math.sin(cam.fpsYaw);
            const fwdZ = -Math.cos(cam.fpsYaw);
            const rightX = Math.cos(cam.fpsYaw);
            const rightZ = -Math.sin(cam.fpsYaw);
            let mx = 0, mz = 0;
            if (cam.keys.w) { mx += fwdX * speed; mz += fwdZ * speed; }
            if (cam.keys.s) { mx -= fwdX * speed; mz -= fwdZ * speed; }
            if (cam.keys.d) { mx += rightX * speed; mz += rightZ * speed; }
            if (cam.keys.a) { mx -= rightX * speed; mz -= rightZ * speed; }

            let nx = Math.max(-2.35, Math.min(3.25, cam.fpsX + mx));
            let nz = Math.max(-1.85, Math.min(2.18, cam.fpsZ + mz));

            // Colisão leve apenas com as paredes laterais/fundo da estufa (permite chegar na porta aberta!)
            const inTentX = nx > GX - halfW - 0.18 && nx < GX + halfW + 0.18;
            const inTentZ = nz > GZ - halfD - 0.18 && nz < GZ + halfD - 0.05;
            if (inTentX && inTentZ) {
                nx = cam.fpsX;
                nz = cam.fpsZ;
            }
            cam.fpsX = nx;
            cam.fpsZ = nz;
            const walking = (mx !== 0 || mz !== 0);
            const bob = walking ? Math.sin(simTime * 6.5) * 0.025 : 0;

            camera.position.set(cam.fpsX, cam.fpsY + bob, cam.fpsZ);
            camera.lookAt(
                cam.fpsX + fwdX * Math.cos(cam.fpsPitch),
                cam.fpsY + bob + Math.sin(cam.fpsPitch),
                cam.fpsZ + fwdZ * Math.cos(cam.fpsPitch)
            );
        } else {
            if (cam.autoRotate && !cam.dragging) cam.targetTheta += 0.003;
            cam.theta += (cam.targetTheta - cam.theta) * 0.12;
            cam.phi += (cam.targetPhi - cam.phi) * 0.12;
            cam.radius += (cam.targetRadius - cam.radius) * 0.12;

            const lookX = 0.15, lookY = 1.22, lookZ = -0.35;
            camera.position.set(
                lookX + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
                lookY + cam.radius * Math.cos(cam.phi),
                lookZ + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta)
            );
            camera.lookAt(lookX, lookY, lookZ);
        }

        ledLight.intensity += ((state.luz ? 1.85 : 0.0) - ledLight.intensity) * 0.12;
        ledBarMat.emissiveIntensity = state.luz ? 1.4 : 0.05;
        ambientLight.intensity = state.luz ? 0.95 : 0.72;
        acVaneMat.emissiveIntensity = state.ar ? 0.85 : 0.05;
        acLedMat.color.setHex(state.ar ? 0x38bdf8 : 0x475569);

        if (state.vento && ventoHelice) ventoHelice.rotation.x += 0.42;
        if (state.exaust && exaustHelice) exaustHelice.rotation.y += 0.46;

        stepFluidPhysics();
        renderer.render(scene, camera);
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
        scene.background = new THREE.Color(0x162032);
        scene.fog = new THREE.FogExp2(0x162032, 0.035);

        const w = container.clientWidth || 640, h = container.clientHeight || 420;
        camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 50);

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
        scene.add(ambientLight);
        const keyLight = new THREE.DirectionalLight(0xfffbeb, 0.95);
        keyLight.position.set(3.0, 5.5, 4.5);
        scene.add(keyLight);
        const winLight = new THREE.DirectionalLight(0xbae6fd, 0.45);
        winLight.position.set(-4, 2.5, 1);
        scene.add(winLight);

        scene.add(buildRoom());
        scene.add(buildTent());
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
        if (preset === 'frente') { cam.targetTheta = 0.05; cam.targetPhi = 1.22; cam.targetRadius = 5.4; }
        else if (preset === 'topo') { cam.targetTheta = 0.35; cam.targetPhi = 0.55; cam.targetRadius = 6.2; }
        else if (preset === 'interior') { cam.targetTheta = -0.05; cam.targetPhi = 1.30; cam.targetRadius = 3.2; }
        else { cam.targetTheta = 0.35; cam.targetPhi = 1.15; cam.targetRadius = 6.4; }
    };

    window.setTwinFpsMode = function (ativo) {
        cam.mode = ativo ? 'fps' : 'orbit';
        if (ativo) {
            cam.fpsX = 0.45; cam.fpsY = 1.65; cam.fpsZ = 1.65;
            cam.fpsYaw = 0.22; cam.fpsPitch = -0.06;
        }
        return cam.mode === 'fps';
    };

    window.setTwinFpsKey = function (k, pressed) {
        if (k in cam.keys) cam.keys[k] = !!pressed;
    };

    window.toggleTwinAutoRotate = function () {
        cam.autoRotate = !cam.autoRotate;
        return cam.autoRotate;
    };

    window.resetTwinCamera = function () {
        window.setTwinCameraPreset('default');
    };
})();
