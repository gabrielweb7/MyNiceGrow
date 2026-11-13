/**
 * twin3d.js — Gêmeo Digital 3D Interativo (Three.js) com Física de Fluidos Térmica
 * - Órbita 360° com mouse/touch + zoom + presets
 * - Solver 3D de partículas fluidas com empuxo térmico, turbulência curl, vórtice do ventilador,
 *   sucção do exaustor + entrada de ar novo (troca de ar) e cor dinâmica pela temperatura local.
 */
(function () {
    let scene, camera, renderer, container;
    let initialized = false;
    let simTime = 0;

    let ledBarMat, ledLight, ambientLight;
    let ventoHelice, exaustHelice;
    let thermalRingMat, acGlowMat;

    // Sistema unificado de fluido interno (ar + névoa) com cor por temperatura (vertexColors)
    const AIR_COUNT = 340;
    let airPoints, airPos, airCol;
    const airParticles = [];

    // Sistema de jato frio do AC no quarto
    const AC_COUNT = 110;
    let acPoints, acPos, acCol;
    const acParticles = [];

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
        theta: 0.42,
        phi: 1.18,
        radius: 5.4,
        targetTheta: 0.42,
        targetPhi: 1.18,
        targetRadius: 5.4,
        dragging: false,
        lastX: 0,
        lastY: 0,
        pinchDist: 0,
        autoRotate: false
    };

    const W = 1.55, H = 2.45, D = 1.35;
    const halfW = W / 2, halfD = D / 2;

    // Mapeia temperatura (°C) -> cor RGB (Azul gelado -> Ciano -> Verde ideal -> Amarelo -> Vermelho)
    function tempToRGB(t, isMist) {
        const clamped = Math.max(19.0, Math.min(31.0, t));
        let r, g, b;
        if (clamped <= 23.0) {
            const u = (clamped - 19.0) / 4.0;
            r = 0.15 + 0.05 * u;
            g = 0.55 + 0.30 * u;
            b = 1.0;
        } else if (clamped <= 26.0) {
            const u = (clamped - 23.0) / 3.0;
            r = 0.20 * (1 - u) + 0.20 * u;
            g = 0.85 * (1 - u) + 0.88 * u;
            b = 1.0 * (1 - u) + 0.55 * u;
        } else if (clamped <= 28.0) {
            const u = (clamped - 26.0) / 2.0;
            r = 0.20 + 0.78 * u;
            g = 0.88 - 0.10 * u;
            b = 0.55 * (1 - u) + 0.15 * u;
        } else {
            const u = (clamped - 28.0) / 3.0;
            r = 0.98;
            g = 0.78 - 0.52 * u;
            b = 0.15 + 0.15 * u;
        }
        if (isMist) {
            r = r * 0.65 + 0.35;
            g = g * 0.65 + 0.35;
            b = b * 0.65 + 0.35;
        }
        return [r, g, b];
    }

    function createFluidTexture() {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.45)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    }

    function buildTent() {
        const group = new THREE.Group();
        const blackMat = new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.85, metalness: 0.1 });
        const mylarMat = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.26, metalness: 0.8, side: THREE.FrontSide });
        const greenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.35, metalness: 0.3, emissive: 0x052e16, emissiveIntensity: 0.35 });

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

        const poleR = 0.032;
        function addPole(x1, y1, z1, x2, y2, z2) {
            const p1 = new THREE.Vector3(x1, y1, z1);
            const p2 = new THREE.Vector3(x2, y2, z2);
            const len = p1.distanceTo(p2);
            const cyl = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, len, 10), greenMat);
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

        // Aba enrolada no topo da porta frontal
        const roll = new THREE.Mesh(
            new THREE.CylinderGeometry(0.11, 0.11, W * 0.92, 16),
            new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.45, metalness: 0.5 })
        );
        roll.rotation.z = Math.PI / 2;
        roll.position.set(0, H - 0.11, halfD + 0.05);
        group.add(roll);
        [-0.38, 0.38].forEach(ox => {
            const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.06, 14), blackMat);
            strap.rotation.z = Math.PI / 2;
            strap.position.set(ox, H - 0.11, halfD + 0.05);
            group.add(strap);
        });

        // Duto inferior esquerdo (entrada da névoa do umidificador)
        const ductMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.7 });
        const ductIn = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 18), ductMat);
        ductIn.rotation.z = Math.PI / 2;
        ductIn.position.set(-halfW + 0.04, 0.34, 0.32);
        group.add(ductIn);

        // Tela de entrada passiva inferior direita
        const meshVent = new THREE.Mesh(
            new THREE.PlaneGeometry(0.32, 0.24),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9, side: THREE.DoubleSide })
        );
        meshVent.rotation.y = -Math.PI / 2;
        meshVent.position.set(halfW - 0.015, 0.28, -0.35);
        group.add(meshVent);

        // Prateleiras internas + Blocos de Cogumelos
        const shelfMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
        const subMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.85 });
        const capMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.6 });
        const stemMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.7 });

        [0.55, 1.35].forEach((sy) => {
            const shelf = new THREE.Mesh(new THREE.BoxGeometry(W * 0.76, 0.03, D * 0.68), shelfMat);
            shelf.position.set(0, sy, -0.08);
            group.add(shelf);

            [-0.36, 0.36].forEach((bx) => {
                const block = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.38), subMat);
                block.position.set(bx, sy + 0.125, -0.08);
                group.add(block);
                for (let m = 0; m < 4; m++) {
                    const mx = bx + (m - 1.5) * 0.095;
                    const mz = -0.08 + ((m % 2 === 0) ? 0.07 : -0.07);
                    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.09, 8), stemMat);
                    stem.position.set(mx, sy + 0.27, mz);
                    group.add(stem);
                    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), capMat);
                    cap.position.set(mx, sy + 0.31, mz);
                    group.add(cap);
                }
            });
        });

        // Barra LED
        ledBarMat = new THREE.MeshStandardMaterial({ color: 0x334155, emissive: 0xfef08a, emissiveIntensity: 0.05, roughness: 0.3 });
        const ledBar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.68, 0.05, 0.18), ledBarMat);
        ledBar.position.set(0, H - 0.1, -0.05);
        group.add(ledBar);

        ledLight = new THREE.PointLight(0xfef9c3, 0, 4.8, 1.5);
        ledLight.position.set(0, H - 0.2, -0.05);
        group.add(ledLight);

        // Ventilador Interno
        const fanHousing = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 0.08, 16),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.4 })
        );
        fanHousing.rotation.z = Math.PI / 2;
        fanHousing.rotation.y = 0.4;
        fanHousing.position.set(halfW - 0.16, 1.88, 0.15);
        group.add(fanHousing);

        ventoHelice = new THREE.Group();
        ventoHelice.position.set(halfW - 0.2, 1.88, 0.15);
        ventoHelice.rotation.y = 0.4;
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.3, metalness: 0.4 });
        for (let b = 0; b < 3; b++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.24, 0.055), bladeMat);
            blade.rotation.x = (b * Math.PI) / 3;
            ventoHelice.add(blade);
        }
        group.add(ventoHelice);

        // Exaustor Externo no teto
        const exaustTube = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.24, 18), ductMat);
        exaustTube.position.set(-0.35, H + 0.06, -0.15);
        group.add(exaustTube);

        exaustHelice = new THREE.Group();
        exaustHelice.position.set(-0.35, H + 0.1, -0.15);
        const exBladeMat = new THREE.MeshStandardMaterial({ color: 0xfb923c, roughness: 0.35, metalness: 0.4 });
        for (let b = 0; b < 4; b++) {
            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.06), exBladeMat);
            blade.rotation.y = (b * Math.PI) / 4;
            exaustHelice.add(blade);
        }
        group.add(exaustHelice);

        // Anel térmico no piso
        thermalRingMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
        const thermalRing = new THREE.Mesh(new THREE.RingGeometry(1.18, 1.32, 48), thermalRingMat);
        thermalRing.rotation.x = -Math.PI / 2;
        thermalRing.position.set(0, 0.005, 0);
        group.add(thermalRing);

        // Unidade AC lateral
        acGlowMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x38bdf8, emissiveIntensity: 0.08, roughness: 0.3, metalness: 0.6 });
        const acUnit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, 0.72), acGlowMat);
        acUnit.position.set(halfW + 0.38, 1.95, -0.15);
        group.add(acUnit);

        return group;
    }

    function spawnAirParticle(p, mode) {
        if (mode === 'mist') {
            p.x = -halfW + 0.08;
            p.y = 0.30 + Math.random() * 0.14;
            p.z = 0.26 + (Math.random() - 0.5) * 0.16;
            p.vx = 0.018 + Math.random() * 0.014;
            p.vy = 0.008 + Math.random() * 0.010;
            p.vz = (Math.random() - 0.5) * 0.010;
            p.temp = state.tempInt - 0.8;
            p.mist = true;
            p.life = 1.0;
        } else if (mode === 'intake') {
            // Ar novo do quarto entrando pela tela inferior direita (troca de ar)
            p.x = halfW - 0.04;
            p.y = 0.20 + Math.random() * 0.22;
            p.z = -0.35 + (Math.random() - 0.5) * 0.22;
            p.vx = -(0.016 + Math.random() * 0.014);
            p.vy = 0.006 + Math.random() * 0.008;
            p.vz = (Math.random() - 0.5) * 0.010;
            p.temp = state.tempExt;
            p.mist = false;
            p.life = 1.0;
        } else {
            p.x = (Math.random() - 0.5) * (W * 0.86);
            p.y = 0.15 + Math.random() * (H - 0.3);
            p.z = (Math.random() - 0.5) * (D * 0.84);
            p.vx = (Math.random() - 0.5) * 0.004;
            p.vy = (Math.random() - 0.5) * 0.004;
            p.vz = (Math.random() - 0.5) * 0.004;
            p.temp = state.tempInt + (p.y / H - 0.5) * 0.8;
            p.mist = false;
            p.life = 0.6 + Math.random() * 0.4;
        }
    }

    function buildFluids(tex) {
        const geo = new THREE.BufferGeometry();
        airPos = new Float32Array(AIR_COUNT * 3);
        airCol = new Float32Array(AIR_COUNT * 3);
        for (let i = 0; i < AIR_COUNT; i++) {
            const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, temp: 26, mist: false, life: 1 };
            spawnAirParticle(p, 'ambient');
            airParticles.push(p);
            airPos[i * 3] = p.x; airPos[i * 3 + 1] = p.y; airPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, p.mist);
            airCol[i * 3] = r; airCol[i * 3 + 1] = g; airCol[i * 3 + 2] = b;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(airCol, 3));
        airPoints = new THREE.Points(geo, new THREE.PointsMaterial({
            size: 0.22,
            map: tex,
            vertexColors: true,
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        scene.add(airPoints);

        // Jato do Ar-Condicionado
        const acGeo = new THREE.BufferGeometry();
        acPos = new Float32Array(AC_COUNT * 3);
        acCol = new Float32Array(AC_COUNT * 3);
        for (let i = 0; i < AC_COUNT; i++) {
            const p = {
                x: halfW + 0.28 - Math.random() * 1.1,
                y: 1.92 - Math.random() * 1.4,
                z: -0.15 + (Math.random() - 0.5) * 0.65,
                vx: -(0.022 + Math.random() * 0.015),
                vy: -(0.012 + Math.random() * 0.010),
                vz: (Math.random() - 0.5) * 0.008,
                temp: 20.5
            };
            acParticles.push(p);
            acPos[i * 3] = p.x; acPos[i * 3 + 1] = p.y; acPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(20.5, false);
            acCol[i * 3] = r; acCol[i * 3 + 1] = g; acCol[i * 3 + 2] = b;
        }
        acGeo.setAttribute('position', new THREE.BufferAttribute(acPos, 3));
        acGeo.setAttribute('color', new THREE.BufferAttribute(acCol, 3));
        acPoints = new THREE.Points(acGeo, new THREE.PointsMaterial({
            size: 0.16,
            map: tex,
            vertexColors: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }));
        scene.add(acPoints);
    }

    function stepFluidPhysics() {
        simTime += 0.025;
        const targetAmbientTemp = state.tempInt;
        const topHeatBonus = state.luz ? 1.1 : 0.0;

        // Ajusta tamanho visual das partículas conforme névoa ativa
        airPoints.material.size += ((state.umid ? 0.28 : 0.16) - airPoints.material.size) * 0.08;
        airPoints.material.opacity += (((state.umid || state.vento || state.exaust) ? 0.78 : 0.42) - airPoints.material.opacity) * 0.08;

        for (let i = 0; i < AIR_COUNT; i++) {
            const p = airParticles[i];

            // 1. Turbulência Curl 3D suave
            const curlX = Math.sin(p.y * 2.6 + simTime) * Math.cos(p.z * 2.4 + simTime * 0.7) * 0.0016;
            const curlY = Math.sin(p.x * 2.5 + simTime * 0.8) * 0.0012;
            const curlZ = Math.cos(p.y * 2.4 - simTime) * Math.sin(p.x * 2.6 + simTime * 0.6) * 0.0016;
            p.vx += curlX;
            p.vy += curlY;
            p.vz += curlZ;

            // 2. Empuxo térmico (ar mais quente que a média sobe, ar mais frio desce)
            const buoyancy = (p.temp - (targetAmbientTemp - 0.3)) * 0.00085;
            p.vy += buoyancy;

            // 3. Vórtice do Ventilador Interno (circulação forçada)
            if (state.vento) {
                const dx = p.x;
                const dz = p.z;
                const dist = Math.hypot(dx, dz) + 0.05;
                // Torque tangencial + leve empuxo descendente das pás
                p.vx += (-dz / dist) * 0.0048;
                p.vz += (dx / dist) * 0.0048;
                if (p.x > 0.25 && p.y > 1.4) {
                    p.vx -= 0.0045;
                    p.vy -= 0.0025;
                }
            }

            // 4. Sucção do Exaustor Externo no teto (-0.35, H, -0.15)
            if (state.exaust) {
                const ex = -0.35 - p.x;
                const ey = (H + 0.35) - p.y;
                const ez = -0.15 - p.z;
                const d = Math.hypot(ex, ey, ez) + 0.2;
                const pull = 0.0075 / (0.6 + d);
                p.vx += (ex / d) * pull;
                p.vy += (ey / d) * pull + 0.0018;
                p.vz += (ez / d) * pull;
            }

            // Amortecimento viscoso
            p.vx *= 0.96;
            p.vy *= 0.96;
            p.vz *= 0.96;

            p.x += p.vx;
            p.y += p.vy;
            p.z += p.vz;

            // Troca térmica local: teto com LED aquece, resto tende a tempInt (ou tempExt se exaustor puxar)
            const localGoal = targetAmbientTemp + (p.y > 1.85 ? topHeatBonus : 0) - (state.ar ? 0.5 : 0);
            p.temp += (localGoal - p.temp) * 0.012;

            // Saiu pelo duto de exaustão? Respawna na entrada de ar novo (troca de ar!) ou névoa
            const saiuExaust = state.exaust && p.y > H + 0.55;
            if (!state.exaust) {
                if (p.y > H - 0.08) { p.y = H - 0.08; p.vy *= -0.45; }
            } else if (p.y > H - 0.05 && Math.hypot(p.x + 0.35, p.z + 0.15) > 0.24) {
                p.y = H - 0.05;
                p.vy *= -0.4;
            }

            // Colisão suave com paredes da estufa
            if (p.x < -halfW + 0.06) { p.x = -halfW + 0.06; p.vx *= -0.5; }
            if (p.x > halfW - 0.06) { p.x = halfW - 0.06; p.vx *= -0.5; }
            if (p.z < -halfD + 0.06) { p.z = -halfD + 0.06; p.vz *= -0.5; }
            if (p.z > halfD - 0.06) { p.z = halfD - 0.06; p.vz *= -0.5; }
            if (p.y < 0.08) { p.y = 0.08; p.vy *= -0.35; }

            p.life -= state.exaust ? 0.008 : 0.0035;
            if (saiuExaust || p.life <= 0) {
                if (state.umid && (i % 2 === 0 || !state.exaust)) {
                    spawnAirParticle(p, 'mist');
                } else if (state.exaust) {
                    spawnAirParticle(p, 'intake');
                } else {
                    spawnAirParticle(p, 'ambient');
                }
            }

            airPos[i * 3] = p.x;
            airPos[i * 3 + 1] = p.y;
            airPos[i * 3 + 2] = p.z;
            const [r, g, b] = tempToRGB(p.temp, p.mist && state.umid);
            airCol[i * 3] = r;
            airCol[i * 3 + 1] = g;
            airCol[i * 3 + 2] = b;
        }
        airPoints.geometry.attributes.position.needsUpdate = true;
        airPoints.geometry.attributes.color.needsUpdate = true;

        // Jato frio do AC externo
        acPoints.material.opacity += ((state.ar ? 0.85 : 0) - acPoints.material.opacity) * 0.1;
        if (acPoints.material.opacity > 0.02) {
            const acColdTemp = Math.min(22.0, state.tempExt - 3.5);
            const [r, g, b] = tempToRGB(acColdTemp, false);
            for (let i = 0; i < AC_COUNT; i++) {
                const p = acParticles[i];
                p.x += p.vx;
                p.y += p.vy + Math.sin(simTime * 2 + i) * 0.002;
                p.z += p.vz;
                if (p.x < -0.65 || p.y < 0.12) {
                    p.x = halfW + 0.28;
                    p.y = 1.92 + (Math.random() - 0.5) * 0.22;
                    p.z = -0.15 + (Math.random() - 0.5) * 0.55;
                }
                acPos[i * 3] = p.x; acPos[i * 3 + 1] = p.y; acPos[i * 3 + 2] = p.z;
                acCol[i * 3] = r; acCol[i * 3 + 1] = g; acCol[i * 3 + 2] = b;
            }
            acPoints.geometry.attributes.position.needsUpdate = true;
            acPoints.geometry.attributes.color.needsUpdate = true;
        }
    }

    function bindControls(el) {
        el.addEventListener('pointerdown', (e) => {
            cam.dragging = true;
            cam.lastX = e.clientX;
            cam.lastY = e.clientY;
        });
        window.addEventListener('pointermove', (e) => {
            if (!cam.dragging) return;
            const dx = e.clientX - cam.lastX;
            const dy = e.clientY - cam.lastY;
            cam.lastX = e.clientX;
            cam.lastY = e.clientY;
            cam.targetTheta -= dx * 0.008;
            cam.targetPhi = Math.max(0.35, Math.min(1.52, cam.targetPhi - dy * 0.006));
        });
        window.addEventListener('pointerup', () => { cam.dragging = false; });

        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            cam.targetRadius = Math.max(3.2, Math.min(8.5, cam.targetRadius + e.deltaY * 0.004));
        }, { passive: false });

        el.addEventListener('touchstart', (e) => {
            if (e.touches.length === 2) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                cam.pinchDist = Math.hypot(dx, dy);
            }
        }, { passive: true });

        el.addEventListener('touchmove', (e) => {
            if (e.touches.length === 2 && cam.pinchDist > 0) {
                const dx = e.touches[0].clientX - e.touches[1].clientX;
                const dy = e.touches[0].clientY - e.touches[1].clientY;
                const dist = Math.hypot(dx, dy);
                cam.targetRadius = Math.max(3.2, Math.min(8.5, cam.targetRadius - (dist - cam.pinchDist) * 0.01));
                cam.pinchDist = dist;
            }
        }, { passive: true });

        el.addEventListener('dblclick', () => window.resetTwinCamera());
    }

    function animate() {
        requestAnimationFrame(animate);
        if (!renderer || !scene || !camera) return;

        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            if (renderer.domElement.width !== Math.floor(w * dpr) || renderer.domElement.height !== Math.floor(h * dpr)) {
                renderer.setSize(w, h, false);
                camera.aspect = w / h;
                camera.updateProjectionMatrix();
            }
        }

        if (cam.autoRotate && !cam.dragging) cam.targetTheta += 0.003;
        cam.theta += (cam.targetTheta - cam.theta) * 0.12;
        cam.phi += (cam.targetPhi - cam.phi) * 0.12;
        cam.radius += (cam.targetRadius - cam.radius) * 0.12;

        const lookY = 1.2;
        camera.position.set(
            cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta),
            lookY + cam.radius * Math.cos(cam.phi),
            cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta)
        );
        camera.lookAt(0, lookY, 0);

        const targetLed = state.luz ? 1.85 : 0.0;
        ledLight.intensity += (targetLed - ledLight.intensity) * 0.12;
        ledBarMat.emissiveIntensity = state.luz ? 1.4 : 0.05;
        ambientLight.intensity = state.luz ? 0.95 : 0.55;

        const [tr, tg, tb] = tempToRGB(state.tempInt, false);
        thermalRingMat.color.setRGB(tr, tg, tb);
        acGlowMat.emissiveIntensity = state.ar ? 0.95 : 0.08;

        if (state.vento && ventoHelice) ventoHelice.rotation.x += 0.42;
        if (state.exaust && exaustHelice) exaustHelice.rotation.y += 0.46;

        stepFluidPhysics();
        renderer.render(scene, camera);
    }

    window.initTwin3D = function (containerEl) {
        if (initialized || !containerEl) return;
        container = containerEl;
        if (typeof THREE === 'undefined') {
            container.innerHTML = '<div class="h-full flex items-center justify-center text-xs text-rose-300 p-6 text-center">Three.js não carregou. Verifique sua conexão com a internet.</div>';
            return;
        }
        initialized = true;

        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050811);
        scene.fog = new THREE.FogExp2(0x050811, 0.06);

        const w = container.clientWidth || 640;
        const h = container.clientHeight || 420;
        camera = new THREE.PerspectiveCamera(44, w / h, 0.1, 50);

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        container.innerHTML = '';
        container.appendChild(renderer.domElement);

        ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
        scene.add(ambientLight);
        const keyLight = new THREE.DirectionalLight(0xe0f2fe, 0.9);
        keyLight.position.set(3.5, 5.5, 4.5);
        scene.add(keyLight);
        const rimLight = new THREE.DirectionalLight(0x34d399, 0.35);
        rimLight.position.set(-4, 3, -3);
        scene.add(rimLight);

        scene.add(new THREE.GridHelper(8, 16, 0x1e293b, 0x0f172a));
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
        if (preset === 'frente') { cam.targetTheta = 0.08; cam.targetPhi = 1.24; cam.targetRadius = 5.0; }
        else if (preset === 'topo') { cam.targetTheta = 0.45; cam.targetPhi = 0.52; cam.targetRadius = 5.6; }
        else if (preset === 'interior') { cam.targetTheta = 0.05; cam.targetPhi = 1.32; cam.targetRadius = 3.35; }
        else { cam.targetTheta = 0.42; cam.targetPhi = 1.18; cam.targetRadius = 5.4; }
    };

    window.toggleTwinAutoRotate = function () {
        cam.autoRotate = !cam.autoRotate;
        return cam.autoRotate;
    };

    window.resetTwinCamera = function () {
        window.setTwinCameraPreset('default');
    };
})();
