/* ==========================================================================
 *  app.js — محاكاة القيادة الذاتية داخل مدينة ثلاثية الأبعاد
 *  المشهد: طريق بأربعة مسارات + تقاطعات + أرصفة + مباني + أشجار + أعمدة إنارة
 *  الميزات: نهار/ليل بظلال وإضاءة سيارة • كاميرا تفاعلية • سحب العناصر داخل المدينة
 * ========================================================================== */
(function () {
    'use strict';
    const T = THREE, Mdl = window.Models;

    /* ------------------------------------------------------------ constants */
    const ROAD_HALF = 7.6;                       // نصف عرض الطريق
    const LANES = [-5.7, -1.9, 1.9, 5.7];        // مراكز المسارات (اليمين = اتجاه سير السيارة)
    const EGO_LANE = 1.9, OUT_LANE = 5.7;
    const CAR_Z = 4;                             // موضع السيارة الثابت (العالم يتحرك نحوها)
    const SEG_LEN = 60, SEG_N = 6;
    const K = 0.3;                               // km/h → وحدة/ثانية
    const CRUISE = 80;
    const API = 'http://localhost:8000';
    const MAX_OBJECTS = 14;
    const USE_ENV = /[?&]env=1/.test(location.search);   // خرائط الانعكاس تجريبية (معطّلة افتراضياً)

    /* ---------------------------------------------------------- object meta */
    const META = {
        speed_limit:   { name: 'شاخصة تخفيف السرعة (30)', icon: 'fa-gauge-high',      color: 'text-amber-400' },
        stop_sign:     { name: 'شاخصة التوقف (STOP)',      icon: 'fa-hand',            color: 'text-red-500' },
        pass_right:    { name: 'تجاوز من اليمين فقط',      icon: 'fa-arrow-turn-right', color: 'text-blue-400' },
        cone:          { name: 'قمع مروري',                icon: 'fa-triangle-exclamation', color: 'text-orange-400' },
        traffic_light: { name: 'إشارة مرورية',             icon: 'fa-traffic-light',   color: 'text-emerald-400' },
        pedestrian:    { name: 'شخص (مشاة)',               icon: 'fa-person-walking',  color: 'text-purple-400' },
        zebra:         { name: 'ممر مشاة (Zebra)',         icon: 'fa-bars-staggered',  color: 'text-gray-200' },
        vehicle:       { name: 'مركبة أمامية',             icon: 'fa-car',             color: 'text-cyan-400' }
    };
    const BADGE = {
        red:    'bg-red-500/20 text-red-400 border-red-500/30',
        amber:  'bg-amber-500/20 text-amber-400 border-amber-500/30',
        blue:   'bg-blue-500/20 text-blue-400 border-blue-500/30',
        purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
        cyan:   'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
        green:  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
    };

    /* --------------------------------------------------------------- state */
    const S = {
        speed: CRUISE, target: CRUISE, laneX: EGO_LANE, laneTarget: EGO_LANE,
        night: 0, nightTarget: 0, placed: [], selected: null, nextId: 1,
        backend: false, camMode: 'chase', yaw: 0, pitch: 1.18, dist: 11.5,
        winMats: [], beacons: [], time: 0, braking: false, uid: 0, frame: 0
    };
    let scene, camera, renderer, container, sun, hemi, skyMat, skyDome, stars, sunSprite, moonSprite;
    let ego, segments = [], ambient = [], groundPlane, shadowTarget;
    let amb, envDay = null, envNight = null, lampMat, lampPoolMat, ringMesh;
    const raycaster = new T.Raycaster(), ndc = new T.Vector2(), groundPlaneMath = new T.Plane(new T.Vector3(0, 1, 0), 0);
    const clock = new T.Clock();

    /* ====================================================================
     *  SCENE SETUP
     * ==================================================================== */
    function init() {
        container = document.getElementById('three-canvas-container');
        const w = container.clientWidth, h = container.clientHeight;

        scene = new T.Scene();
        scene.fog = new T.FogExp2(0x8fb8e6, 0.0042);

        camera = new T.PerspectiveCamera(52, w / h, 0.1, 900);
        renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.outputEncoding = T.sRGBEncoding;
        renderer.toneMapping = T.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = T.PCFSoftShadowMap;
        container.appendChild(renderer.domElement);

        buildSky();
        buildLights();
        if (USE_ENV) { try { buildEnvironmentMaps(); } catch (err) { console.warn('env map disabled', err); envDay = envNight = null; scene.environment = null; } }
        buildGround();
        for (let i = 0; i < SEG_N; i++) segments.push(buildSegment(i));
        buildEgo();
        buildAmbientTraffic();
        buildSelectionRing();

        applyNight(0, true);
        bindPointer();
        bindKeys();
        bindUI();
        new ResizeObserver(onResize).observe(container);

        checkBackend(); setInterval(checkBackend, 8000);
        runPipeline('stop_sign');
        animate();
    }

    /* ----------------------------------------------------------------- sky */
    function skyMaterial(gamma) {
        return new T.ShaderMaterial({
            side: T.BackSide, depthWrite: false, fog: false,
            uniforms: {
                top: { value: new T.Color() }, hor: { value: new T.Color() },
                bot: { value: new T.Color() }, uGamma: { value: gamma ? 1.0 : 0.0 }
            },
            vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; uniform float uGamma; varying vec3 vP;' +
                'void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.5)) : mix(hor, bot, pow(-h, 0.6));' +
                'if(uGamma > 0.5) c = pow(c, vec3(0.4545)); gl_FragColor = vec4(c, 1.0); }'
        });
    }
    function glowSprite(r, g, b, size) {
        const m = new T.SpriteMaterial({ map: Mdl.radialTex(r, g, b), transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending });
        const s = new T.Sprite(m); s.scale.set(size, size, 1); return s;
    }
    function buildSky() {
        skyMat = skyMaterial(true);
        skyDome = new T.Mesh(new T.SphereGeometry(600, 32, 16), skyMat);
        skyDome.renderOrder = -10; scene.add(skyDome);

        const sg = new T.BufferGeometry(), pos = [], r = Mdl.rng(5);
        for (let i = 0; i < 900; i++) {
            const th = r() * Math.PI * 2, ph = Math.acos(r() * 0.95 + 0.05);
            pos.push(Math.sin(ph) * Math.cos(th) * 560, Math.cos(ph) * 560, Math.sin(ph) * Math.sin(th) * 560);
        }
        sg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        stars = new T.Points(sg, new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
        scene.add(stars);

        sunSprite = glowSprite(255, 236, 190, 150); scene.add(sunSprite);
        moonSprite = glowSprite(200, 215, 255, 70); scene.add(moonSprite);
    }

    function buildLights() {
        sun = new T.DirectionalLight(0xffeccc, 2.8);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        const sc = sun.shadow.camera;
        sc.left = -55; sc.right = 55; sc.top = 55; sc.bottom = -55; sc.near = 1; sc.far = 260; sc.updateProjectionMatrix();
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
        shadowTarget = new T.Object3D(); scene.add(shadowTarget); sun.target = shadowTarget;
        scene.add(sun);
        hemi = new T.HemisphereLight(0xbcd8ff, 0x6b6a5e, 0.65);
        scene.add(hemi);
        amb = new T.AmbientLight(0xffffff, 0.35);
        scene.add(amb);
    }

    /* خرائط البيئة (للانعكاسات على طلاء السيارة والزجاج) */
    function buildEnvironmentMaps() {
        const pm = new T.PMREMGenerator(renderer);
        function make(topC, horC, botC, extras) {
            const sc = new T.Scene();
            const m = skyMaterial(false);
            m.uniforms.top.value.setRGB(topC[0], topC[1], topC[2]);
            m.uniforms.hor.value.setRGB(horC[0], horC[1], horC[2]);
            m.uniforms.bot.value.setRGB(botC[0], botC[1], botC[2]);
            sc.add(new T.Mesh(new T.SphereGeometry(90, 24, 12), m));
            extras(sc);
            const rt = pm.fromScene(sc, 0.02); return rt.texture;
        }
        envDay = make([0.12, 0.3, 0.7], [0.6, 0.75, 0.9], [0.18, 0.18, 0.17], function (sc) {
            const sunM = new T.Mesh(new T.SphereGeometry(7, 12, 8), new T.MeshBasicMaterial({ color: new T.Color(14, 12, 10) }));
            sunM.position.set(45, 55, -25); sc.add(sunM);
            const soft = new T.Mesh(new T.PlaneGeometry(40, 14), new T.MeshBasicMaterial({ color: new T.Color(3, 3, 3.2), side: T.DoubleSide }));
            soft.position.set(-30, 40, 30); soft.lookAt(0, 0, 0); sc.add(soft);
        });
        envNight = make([0.002, 0.005, 0.02], [0.02, 0.03, 0.07], [0.01, 0.01, 0.012], function (sc) {
            [[-40, 14, -40], [40, 14, -30], [-35, 12, 20], [38, 15, 30]].forEach(function (p) {
                const l = new T.Mesh(new T.SphereGeometry(3, 8, 6), new T.MeshBasicMaterial({ color: new T.Color(7, 4, 1.6) }));
                l.position.set(p[0], p[1], p[2]); sc.add(l);
            });
            const moon = new T.Mesh(new T.SphereGeometry(4, 10, 8), new T.MeshBasicMaterial({ color: new T.Color(3.5, 4, 5.5) }));
            moon.position.set(-30, 60, -45); sc.add(moon);
        });
        pm.dispose();
        scene.environment = envDay;
    }

    /* --------------------------------------------------------------- ground */
    function buildGround() {
        const tex = Mdl.canvasTex(256, 256, function (c, w, h) {
            c.fillStyle = '#3a3d41'; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 2500; i++) { c.fillStyle = 'rgba(' + (30 + Math.random() * 40 | 0) + ',' + (32 + Math.random() * 40 | 0) + ',' + (34 + Math.random() * 40 | 0) + ',0.5)'; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
        }, { repeat: true });
        tex.repeat.set(120, 120);
        groundPlane = new T.Mesh(new T.PlaneGeometry(1200, 1200), new T.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
        groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.y = -0.06; groundPlane.receiveShadow = true;
        scene.add(groundPlane);
    }

    /* ------------------------------------------------------- road textures */
    function roadTexture() {
        const PX = 512 / 15.2, PZ = 512 / 12;               // بكسل لكل متر
        const t = Mdl.canvasTex(512, 512, function (c, w, h) {
            c.fillStyle = '#303338'; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 14000; i++) {
                const v = 38 + Math.random() * 40 | 0;
                c.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 3) + ',0.55)';
                c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
            }
            c.setTransform(PX, 0, 0, PZ, 0, 0);          // من الآن: الرسم بالمتر
            c.fillStyle = 'rgba(0,0,0,0.10)';             // آثار الإطارات
            [1.2, 2.6, 5.0, 6.4, 8.8, 10.2, 12.6, 14.0].forEach(function (x) { c.fillRect(x - 0.28, 0, 0.56, 12); });
            c.fillStyle = '#e8b81c';                      // خط أصفر مزدوج
            c.fillRect(7.42, 0, 0.12, 12); c.fillRect(7.66, 0, 0.12, 12);
            c.fillStyle = '#ececE6';                      // حواف
            c.fillRect(0.3, 0, 0.16, 12); c.fillRect(14.74, 0, 0.16, 12);
            [3.8, 11.4].forEach(function (x) { c.fillRect(x - 0.075, 1.5, 0.15, 3.2); c.fillRect(x - 0.075, 7.5, 0.15, 3.2); }); // متقطع
            c.setTransform(1, 0, 0, 1, 0, 0);
        }, { repeat: true });
        return t;
    }
    function paverTexture() {
        const t = Mdl.canvasTex(256, 256, function (c, w, h) {
            c.fillStyle = '#9a9a96'; c.fillRect(0, 0, w, h);
            for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
                const v = 140 + Math.random() * 30 | 0;
                c.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 3) + ')'; c.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
            }
        }, { repeat: true });
        return t;
    }

    let roadMat, crossMat, walkMat, curbMat;
    function buildSegment(idx) {
        const g = new T.Group(); const r = Mdl.rng(900 + idx * 13);
        if (!roadMat) {
            const rt = roadTexture(); rt.repeat.set(1, SEG_LEN / 12);
            roadMat = new T.MeshStandardMaterial({ map: rt, roughness: 0.82, metalness: 0.0 });
            const ct = Mdl.canvasTex(256, 256, function (c, w, h) {
                c.fillStyle = '#303338'; c.fillRect(0, 0, w, h);
                for (let i = 0; i < 6000; i++) { const v = 38 + Math.random() * 38 | 0; c.fillStyle = 'rgb(' + v + ',' + v + ',' + (v + 3) + ')'; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
                c.fillStyle = '#e8e8e0'; for (let x = 10; x < w; x += 120) c.fillRect(x, h / 2 - 3, 60, 6);
            }, { repeat: true });
            ct.repeat.set(24, 1);
            crossMat = new T.MeshStandardMaterial({ map: ct, roughness: 0.85 });
            const pt = paverTexture(); pt.repeat.set(2, 12);
            walkMat = new T.MeshStandardMaterial({ map: pt, roughness: 0.9 });
            curbMat = new T.MeshStandardMaterial({ color: 0xb4b4ae, roughness: 0.85 });
            lampMat = new T.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffd89a, emissiveIntensity: 0.1 });
            lampPoolMat = new T.MeshBasicMaterial({ map: Mdl.radialTex(255, 214, 140), transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false });
        }
        /* الطريق الرئيسي والشارع المتقاطع */
        const road = new T.Mesh(new T.PlaneGeometry(ROAD_HALF * 2, SEG_LEN), roadMat);
        road.rotation.x = -Math.PI / 2; road.receiveShadow = true; g.add(road);
        const cross = new T.Mesh(new T.PlaneGeometry(240, 14), crossMat);
        cross.rotation.x = -Math.PI / 2; cross.position.y = 0.004; cross.receiveShadow = true; g.add(cross);

        /* الأرصفة (مقسومة عند التقاطع) */
        [-1, 1].forEach(function (side) {
            [[-30, -7], [7, 30]].forEach(function (zr) {
                const len = zr[1] - zr[0], zc = (zr[0] + zr[1]) / 2;
                const wk = new T.Mesh(new T.BoxGeometry(5.0, 0.2, len), walkMat);
                wk.position.set(side * 10.1, 0.1, zc); wk.receiveShadow = true; wk.castShadow = true; g.add(wk);
                const cb = new T.Mesh(new T.BoxGeometry(0.3, 0.24, len), curbMat);
                cb.position.set(side * 7.75, 0.12, zc); cb.receiveShadow = true; g.add(cb);
            });
            [-1, 1].forEach(function (sz) {
                const w2 = new T.Mesh(new T.BoxGeometry(87, 0.2, 2), walkMat);
                w2.position.set(side * 56.1, 0.1, sz * 8); w2.receiveShadow = true; g.add(w2);
            });
        });

        /* ممرات مشاة ثابتة عند التقاطع */
        [-1, 1].forEach(function (sz) { const z = Mdl.zebra(); z.group.position.z = sz * 8.6; g.add(z.group); });

        /* المباني (كتلتان لكل جهة) */
        [-1, 1].forEach(function (side) {
            [[10, 29], [-29, -10]].forEach(function (blk) {
                let z0 = blk[0]; const z1 = blk[1];
                const zStart = Math.min(z0, z1), zEnd = Math.max(z0, z1);
                let cursor = zStart;
                while (cursor < zEnd - 6) {
                    let wdt = 9 + r() * 11;
                    if (cursor + wdt > zEnd) wdt = zEnd - cursor;
                    const dpt = 24 + r() * 16, hgt = 20 + Math.floor(r() * r() * 70);
                    const b = Mdl.building({ w: wdt - 0.6, d: dpt, h: hgt, style: Math.floor(r() * 6), seed: Math.floor(r() * 1e6) });
                    b.group.position.set(side * (13.8 + dpt / 2), 0, cursor + wdt / 2);
                    g.add(b.group);
                    b.nightMats.forEach(function (m) { S.winMats.push(m); });
                    if (b.beacon) S.beacons.push(b.beacon);
                    cursor += wdt;
                }
            });
            /* أشجار + أعمدة إنارة */
            [-26, -17, 17, 26].forEach(function (z, i) {
                const t = Mdl.tree(Math.floor(r() * 1e5)); t.position.set(side * 11.4, 0.2, z + (r() - 0.5) * 2);
                t.rotation.y = r() * 6.28; t.scale.setScalar(0.85 + r() * 0.4); g.add(t);
            });
            [-22, -13, 13, 22].forEach(function (z) {
                const lp = Mdl.streetLamp(side, lampMat); lp.position.set(side * 8.4, 0.2, z); g.add(lp);
                const pool = new T.Mesh(new T.PlaneGeometry(10, 10), lampPoolMat);
                pool.rotation.x = -Math.PI / 2; pool.position.set(side * 5.9, 0.07, z); pool.renderOrder = 2; g.add(pool);
            });
        });

        g.position.z = CAR_Z + 30 - idx * SEG_LEN;
        scene.add(g);
        return g;
    }

    /* ------------------------------------------------------------ ego car */
    function buildEgo() {
        ego = Mdl.buildCar({ color: 0x1b4fd6, spots: true });
        ego.group.position.set(EGO_LANE, 0, CAR_Z);
        scene.add(ego.group);
    }
    function buildAmbientTraffic() {
        const cols = [0xe8e8e8, 0x8b1a1a, 0x1c1c1f, 0xd9a21b, 0x2f6f4f, 0x9aa3ad];
        for (let i = 0; i < 6; i++) {
            const car = Mdl.buildCar({ color: cols[i % cols.length] });
            const lane = i % 2 ? LANES[0] : LANES[1];
            const z = -40 - i * 55 - Math.random() * 20;
            car.group.position.set(lane, 0, z); car.group.rotation.y = Math.PI;
            scene.add(car.group);
            ambient.push({ car: car, z: z, x: lane });
        }
    }

    /* ======================================================== DAY / NIGHT == */
    const C = function (r, g, b) { return new T.Color(r, g, b); };
    const DAY = { top: C(0.1, 0.3, 0.72), hor: C(0.55, 0.72, 0.92), bot: C(0.2, 0.2, 0.19) };
    const NIGHT = { top: C(0.0008, 0.0025, 0.012), hor: C(0.014, 0.022, 0.055), bot: C(0.004, 0.005, 0.01) };
    const tmpC = new T.Color();

    function applyNight(n, force) {
        const e = n * n * (3 - 2 * n);                       // smoothstep
        skyMat.uniforms.top.value.lerpColors(DAY.top, NIGHT.top, e);
        skyMat.uniforms.hor.value.lerpColors(DAY.hor, NIGHT.hor, e);
        skyMat.uniforms.bot.value.lerpColors(DAY.bot, NIGHT.bot, e);
        scene.fog.color.copy(skyMat.uniforms.hor.value);
        scene.fog.density = 0.0042 + e * 0.0028;

        sun.color.lerpColors(C(1.0, 0.92, 0.8), C(0.45, 0.58, 1.0), e);
        sun.intensity = 2.8 + (0.55 - 2.8) * e;
        const sp = new T.Vector3(55, 85, 35).lerp(new T.Vector3(-45, 70, 20), e);
        sun.position.copy(sp).add(shadowTarget.position);
        hemi.color.lerpColors(C(0.74, 0.85, 1.0), C(0.1, 0.15, 0.4), e);
        hemi.groundColor.lerpColors(C(0.42, 0.41, 0.37), C(0.02, 0.025, 0.04), e);
        hemi.intensity = 0.65 + (0.3 - 0.65) * e;
        amb.color.lerpColors(C(1, 1, 1), C(0.25, 0.32, 0.6), e);
        amb.intensity = 0.35 + (0.28 - 0.35) * e;
        renderer.toneMappingExposure = 1.05 + e * 0.35;

        stars.material.opacity = Math.max(0, (e - 0.35) / 0.65);
        sunSprite.position.set(55, 85, 35).multiplyScalar(5.2); sunSprite.material.opacity = 1 - Math.min(1, e * 2.2);
        moonSprite.position.set(-45, 70, 20).multiplyScalar(5.2); moonSprite.material.opacity = Math.min(1, e * 1.6);

        const wi = e * 1.7;
        S.winMats.forEach(function (m) { m.emissiveIntensity = wi; });
        lampMat.emissiveIntensity = 0.1 + e * 5.0;
        lampPoolMat.opacity = e * 0.75;
        roadMat.roughness = 0.82 - e * 0.28; crossMat.roughness = roadMat.roughness;
        if (envDay) scene.environment = e > 0.5 ? envNight : envDay;

        ego.setNight(e);
        ambient.forEach(function (a) { a.car.setNight(e); });
        S.placed.forEach(function (rec) { if (rec.model.setNight) rec.model.setNight(e); });

        const btn = document.getElementById('btn-night');
        if (btn) {
            btn.querySelector('i').className = 'fa-solid ' + (S.nightTarget > 0.5 ? 'fa-sun' : 'fa-moon');
            btn.querySelector('span').innerText = S.nightTarget > 0.5 ? 'نهار' : 'ليل';
        }
    }
    function toggleNight() {
        S.nightTarget = S.nightTarget > 0.5 ? 0 : 1;
        showToast(S.nightTarget > 0.5 ? 'تم التحويل إلى الليل — الكشافات وأعمدة الإنارة تعمل' : 'تم التحويل إلى النهار', 'fa-moon');
    }

    /* =================================================== PLACED OBJECTS === */
    function makeModel(type) {
        const m = {};
        switch (type) {
            case 'speed_limit': case 'pass_right': {
                const s = Mdl.roundSign(type);
                s.faceMat.emissiveMap = s.faceMat.map;
                Object.assign(m, { group: s.group, radius: s.radius, setNight: function (n) { s.faceMat.emissive.setRGB(1, 1, 1); s.faceMat.emissiveIntensity = n * 0.45; } });
                break;
            }
            case 'stop_sign': {
                const s = Mdl.stopSign(); s.faceMat.emissiveMap = s.faceMat.map;
                Object.assign(m, { group: s.group, radius: s.radius, setNight: function (n) { s.faceMat.emissive.setRGB(1, 1, 1); s.faceMat.emissiveIntensity = n * 0.45; } });
                break;
            }
            case 'cone': {
                const c = Mdl.trafficCone();
                Object.assign(m, { group: c.group, radius: c.radius, setNight: function (n) { c.mats[0].emissiveIntensity = n * 0.35; c.mats[1].emissiveIntensity = n * 0.25; } });
                break;
            }
            case 'traffic_light': {
                const t = Mdl.trafficLight();
                Object.assign(m, { group: t.group, radius: t.radius, light: t, update: function (dt) { t.update(dt); } });
                break;
            }
            case 'pedestrian': {
                const p = Mdl.pedestrian(S.uid++ * 17 + 3);
                Object.assign(m, { group: p.group, radius: p.radius, ped: p });
                break;
            }
            case 'zebra': {
                const z = Mdl.zebra(); Object.assign(m, { group: z.group, radius: 3 }); break;
            }
            default: {
                const cols = [0xd9d9dc, 0xb3261e, 0x1f6f54, 0xe0a31a, 0x3f4756];
                const car = Mdl.buildCar({ color: cols[S.uid++ % cols.length] });
                Object.assign(m, { group: car.group, radius: 2.6, car: car, setNight: function (n) { car.setNight(n); } });
            }
        }
        /* صندوق التقاط شفاف لتسهيل السحب */
        const hit = new T.Mesh(new T.BoxGeometry(m.radius * 1.6, 3.2, m.radius * 1.6),
            new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
        hit.position.y = 1.6; hit.userData.isHit = true; m.group.add(hit);
        return m;
    }

    function snap(type, x, z) {
        const sign = (type === 'speed_limit' || type === 'stop_sign' || type === 'pass_right' || type === 'traffic_light');
        z = Math.max(-150, Math.min(-9, z));
        if (sign) return { x: x >= 0 ? 8.9 : -8.9, z: z };
        if (type === 'zebra') return { x: 0, z: z };
        if (type === 'pedestrian') return { x: Math.max(-9.6, Math.min(9.6, x)), z: z };
        x = Math.max(-6.8, Math.min(6.8, x));
        for (let i = 0; i < LANES.length; i++) if (Math.abs(x - LANES[i]) < 1.0) x = LANES[i];   // مغناطيس المسار
        return { x: x, z: z };
    }

    function spawn(type, x, z) {
        if (S.placed.length >= MAX_OBJECTS) { const old = S.placed[0]; removeRec(old, true); }
        const model = makeModel(type);
        const p = snap(type, x, z);
        const rec = {
            id: S.nextId++, type: type, name: META[type].name, model: model, group: model.group,
            x: p.x, z: p.z, handled: false, hold: 0, dragging: false, walking: false,
            own: type === 'vehicle' ? 40 : 0, oncoming: type === 'vehicle' && p.x < 0, rot: 0
        };
        model.group.userData.rec = rec;
        if (model.light) model.light.setSide(-p.x);
        if (rec.oncoming) model.group.rotation.y = Math.PI;
        if (type === 'pedestrian') rec.dir = p.x > 0 ? -1 : 1;
        if (model.setNight) model.setNight(Math.max(0, S.night));
        if (model.car) model.car.setNight(S.night);
        model.group.position.set(rec.x, type === 'pedestrian' || type === 'speed_limit' ? 0.2 : (p.x === 8.9 || p.x === -8.9) ? 0.2 : 0, rec.z);
        rec.baseY = model.group.position.y;
        scene.add(model.group);
        S.placed.push(rec);
        selectRec(rec);
        tryLoadGLB(rec);

        sendBackend(rec);
        updateHUDobject(rec);
        runPipeline(type);
        renderPlacedList();
        showToast('تم إسقاط: ' + rec.name + ' — يمكنك سحبه داخل المدينة', 'fa-cube');
        return rec;
    }

    function removeRec(rec, silent) {
        scene.remove(rec.group);
        const i = S.placed.indexOf(rec); if (i >= 0) S.placed.splice(i, 1);
        if (S.selected === rec) selectRec(null);
        renderPlacedList();
        if (!silent) showToast('تم حذف: ' + rec.name, 'fa-trash');
    }

    /* استبدال المجسم الإجرائي بنموذج Spline (GLB) إن وُجد: assets/models/<type>.glb */
    const glbCache = {};
    function tryLoadGLB(rec) {
        if (!T.GLTFLoader || location.protocol === 'file:') return;
        const url = 'assets/models/' + rec.type + '.glb';
        if (glbCache[rec.type] === false) return;
        const apply = function (scn) {
            const inst = scn.clone(true);
            inst.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
            rec.group.children.slice().forEach(function (c) { if (!c.userData.isHit) rec.group.remove(c); });
            rec.group.add(inst); rec.model.setNight = null; rec.model.update = null;
        };
        if (glbCache[rec.type]) { apply(glbCache[rec.type]); return; }
        new T.GLTFLoader().load(url, function (gltf) { glbCache[rec.type] = gltf.scene; apply(gltf.scene); },
            undefined, function () { glbCache[rec.type] = false; });
    }

    /* ----------------------------------------------------------- selection */
    function buildSelectionRing() {
        ringMesh = new T.Mesh(new T.RingGeometry(1.0, 1.12, 56),
            new T.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.9, side: T.DoubleSide, depthWrite: false }));
        ringMesh.rotation.x = -Math.PI / 2; ringMesh.visible = false; ringMesh.renderOrder = 5; scene.add(ringMesh);
    }
    function selectRec(rec) {
        S.selected = rec;
        ringMesh.visible = !!rec;
        const lbl = document.getElementById('obj-label');
        if (lbl) lbl.style.opacity = rec ? 1 : 0;
        renderPlacedList();
    }

    /* =================================================== POINTER / DRAG === */
    let drag = null, orbit = null;
    function setNDC(e) {
        const r = renderer.domElement.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
    }
    function groundPoint(e) {
        setNDC(e); const p = new T.Vector3();
        return raycaster.ray.intersectPlane(groundPlaneMath, p) ? p : null;
    }
    function pickRec(e) {
        setNDC(e);
        const groups = S.placed.map(function (r) { return r.group; });
        const hits = raycaster.intersectObjects(groups, true);
        for (let i = 0; i < hits.length; i++) {
            let o = hits[i].object; while (o && !o.userData.rec) o = o.parent;
            if (o) return o.userData.rec;
        }
        return null;
    }
    function bindPointer() {
        const el = renderer.domElement;
        el.addEventListener('pointerdown', function (e) {
            const rec = pickRec(e);
            el.setPointerCapture(e.pointerId);
            if (rec) {
                selectRec(rec); rec.dragging = true; drag = { rec: rec };
                el.style.cursor = 'grabbing';
            } else {
                selectRec(null);
                orbit = { x: e.clientX, y: e.clientY };
            }
        });
        el.addEventListener('pointermove', function (e) {
            if (drag) {
                const p = groundPoint(e); if (!p) return;
                const rec = drag.rec, s = snap(rec.type, p.x, p.z);
                rec.x = s.x; rec.z = s.z;
                if (rec.model.light) rec.model.light.setSide(-s.x);
                if (rec.type === 'vehicle') { rec.oncoming = s.x < 0; rec.group.rotation.y = rec.oncoming ? Math.PI : 0; }
                if (rec.type === 'pedestrian') rec.dir = s.x > 0 ? -1 : 1;
                rec.handled = false; rec.hold = 0; rec.avoid = undefined;
            } else if (orbit) {
                const dx = e.clientX - orbit.x, dy = e.clientY - orbit.y;
                orbit.x = e.clientX; orbit.y = e.clientY;
                S.yaw -= dx * 0.006;
                S.pitch = Math.max(0.25, Math.min(1.45, S.pitch - dy * 0.005));
            } else {
                el.style.cursor = pickRec(e) ? 'grab' : 'default';
            }
        });
        const up = function () {
            if (drag) { drag.rec.dragging = false; drag = null; renderPlacedList(); }
            orbit = null; el.style.cursor = 'default';
        };
        el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        el.addEventListener('wheel', function (e) {
            e.preventDefault(); S.dist = Math.max(5, Math.min(34, S.dist * (1 + e.deltaY * 0.001)));
        }, { passive: false });
    }
    function bindKeys() {
        window.addEventListener('keydown', function (e) {
            if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
            const k = e.key.toLowerCase();
            if (k === 'n') toggleNight();
            else if (k === '1') setCam('chase'); else if (k === '2') setCam('hood'); else if (k === '3') setCam('top');
            else if ((k === 'delete' || k === 'backspace') && S.selected) removeRec(S.selected);
            else if (k === 'r' && S.selected) { S.selected.rot += Math.PI / 4; S.selected.group.rotation.y = S.selected.rot + (S.selected.oncoming ? Math.PI : 0); }
        });
    }

    /* ======================================================= REACTIONS ==== */
    function stopSpeed(d, gap) { return 3.6 * Math.sqrt(2 * 5 * Math.max(0, d - gap)); }

    function evaluate(dt) {
        const front = CAR_Z - 2.35;
        const curLane = S.laneX > 3.8 ? OUT_LANE : EGO_LANE;
        let results = [], laneCone = null, lanePass = null, nearest = null, nd = 1e9;

        S.placed.forEach(function (rec) {
            if (rec.dragging) return;
            const d = front - rec.z;
            if (!rec.handled && d > -1 && d < nd && d < 70) { nd = d; nearest = rec; }
            if (rec.handled) return;
            let res = null;
            switch (rec.type) {
                case 'stop_sign':
                    if (d < -1) { rec.handled = true; break; }
                    if (d < 45) {
                        res = { speed: stopSpeed(d, 2.5), text: 'توقف كامل (Emergency Stop)', cls: 'red' };
                        if (S.speed < 0.8 && d < 9) { rec.hold += dt; if (rec.hold > 2.2) { rec.handled = true; res = null; } }
                    }
                    break;
                case 'traffic_light': {
                    if (d < -1) { rec.handled = true; break; }
                    if (d < 45) {
                        const st = rec.model.light.state;
                        if (st === 'red' || (st === 'yellow' && d > 14)) res = { speed: stopSpeed(d, 3), text: 'توقف عند الإشارة الحمراء', cls: 'red' };
                        else res = { speed: CRUISE, text: 'الإشارة خضراء — المتابعة', cls: 'green' };
                    }
                    break;
                }
                case 'pedestrian': {
                    if (rec.x > 12.5 || rec.x < -12.5) { rec.handled = true; break; }
                    if (d < -1) { rec.handled = true; break; }
                    if (d < 60 && !rec.walking) rec.walking = true;
                    if (d < 45 && Math.abs(rec.x) < 8.2) res = { speed: stopSpeed(d, 5.5), text: 'فرملة لحماية المشاة', cls: 'purple' };
                    break;
                }
                case 'zebra':
                    if (d < -4) { rec.handled = true; break; }
                    if (d < 38) res = { speed: 20, text: 'الاستعداد للتوقف عند ممر المشاة', cls: 'amber' };
                    break;
                case 'speed_limit':
                    if (d < -1) { rec.handled = true; break; }
                    if (d < 40) res = { speed: 30, text: 'تخفيف السرعة إلى 30 كم/سا', cls: 'amber' };
                    break;
                case 'pass_right':
                    if (d < -1) { rec.handled = true; break; }
                    if (d < 34) { res = { speed: 50, text: 'انحراف إلى المسار الأيمن', cls: 'blue' }; lanePass = OUT_LANE; }
                    break;
                case 'cone': {
                    if (d < -3) { rec.handled = true; break; }
                    if (rec.avoid === undefined && d < 32 && Math.abs(rec.x - curLane) < 2.3) rec.avoid = curLane === EGO_LANE ? OUT_LANE : EGO_LANE;
                    if (rec.avoid !== undefined) { res = { speed: 25, text: 'مناورة تفادي القمع', cls: 'amber' }; laneCone = rec.avoid; }
                    break;
                }
                default: {                                          // مركبة أمامية
                    if (rec.oncoming || d < 0 || d > 55 || Math.abs(rec.x - S.laneX) > 2.6) break;
                    const v = d < 13 ? rec.own * 0.5 : d < 30 ? rec.own : Math.min(CRUISE, rec.own + (d - 30) * 1.6);
                    res = { speed: v, text: 'الحفاظ على مسافة الأمان', cls: 'cyan' };
                }
            }
            if (res) results.push(res);
        });

        let tgt = CRUISE, shown = { text: 'قيادة طبيعية ( cruise )', cls: 'green' };
        results.forEach(function (r) { if (r.speed < tgt || (r.speed === tgt && shown.text.indexOf('cruise') > 0)) { tgt = r.speed; shown = r; } });
        S.target = tgt;
        S.laneTarget = laneCone !== null ? laneCone : lanePass !== null ? lanePass : EGO_LANE;
        setReaction(shown.text, shown.cls);
        if (nearest) updateHUDobject(nearest); else clearHUDobject();
    }

    /* ---------------------------------------------------------------- HUD */
    let lastReaction = '', lastHud = -1;
    function setReaction(text, cls) {
        if (text === lastReaction) return; lastReaction = text;
        document.getElementById('reaction-text').innerText = text;
        document.getElementById('reaction-badge').className = 'px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 border ' + BADGE[cls];
    }
    function updateHUDobject(rec) {
        if (lastHud === rec.id) return; lastHud = rec.id;
        const m = META[rec.type];
        document.getElementById('detected-icon').className = 'w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-xl ' + m.color;
        document.getElementById('detected-icon').innerHTML = '<i class="fa-solid ' + m.icon + '"></i>';
        document.getElementById('detected-name').innerText = m.name;
    }
    function clearHUDobject() {
        if (lastHud === -1) return; lastHud = -1;
        document.getElementById('detected-name').innerText = 'لا يوجد شاخصة';
        document.getElementById('detected-icon').innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
        document.getElementById('detected-icon').className = 'w-9 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-xl text-yellow-400';
    }
    function updateSpeedometerUI(speed) {
        const rs = Math.round(speed), g = document.getElementById('speed-gauge');
        document.getElementById('speed-value').innerText = rs;
        g.style.strokeDashoffset = 113 - (Math.min(rs, 120) / 120) * 113;
        g.style.stroke = rs < 10 ? '#ef4444' : rs < 40 ? '#f59e0b' : '#3b82f6';
    }
    let toastTimer;
    function showToast(msg, icon) {
        const t = document.getElementById('toast-notification');
        document.getElementById('toast-message').innerText = msg;
        if (icon) document.getElementById('toast-icon').className = 'fa-solid ' + icon + ' text-blue-400 text-lg';
        t.classList.remove('translate-y-20', 'opacity-0');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.classList.add('translate-y-20', 'opacity-0'); }, 3200);
    }
    function renderPlacedList() {
        const box = document.getElementById('placed-list'); if (!box) return;
        document.getElementById('placed-count').innerText = S.placed.length;
        box.innerHTML = '';
        S.placed.forEach(function (rec) {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] cursor-pointer ' + (S.selected === rec ? 'bg-blue-500/25 border border-blue-500/50' : 'hover:bg-white/5 border border-transparent');
            row.innerHTML = '<i class="fa-solid ' + META[rec.type].icon + ' ' + META[rec.type].color + '"></i><span class="flex-1 truncate">' + rec.name + '</span>' +
                '<button class="text-gray-400 hover:text-red-400" title="حذف"><i class="fa-solid fa-xmark"></i></button>';
            row.addEventListener('click', function () { selectRec(rec); });
            row.querySelector('button').addEventListener('click', function (ev) { ev.stopPropagation(); removeRec(rec); });
            box.appendChild(row);
        });
        if (!S.placed.length) box.innerHTML = '<div class="text-[11px] text-gray-500 px-2 py-1">اسحب عنصراً من القائمة وأفلته في المدينة</div>';
    }

    /* ============================================================ CAMERA == */
    function setCam(mode) {
        S.camMode = mode;
        document.querySelectorAll('[data-cam]').forEach(function (b) {
            b.classList.toggle('bg-blue-600/40', b.dataset.cam === mode);
        });
    }
    const camGoal = new T.Vector3(), lookGoal = new T.Vector3(), lookNow = new T.Vector3(0, 1, -5);
    function updateCamera(dt) {
        const cx = ego.group.position.x;
        if (S.camMode === 'chase') {
            const tx = cx * 0.75, ty = 1.35, tz = CAR_Z - 2;
            const sp = Math.sin(S.pitch);
            camGoal.set(tx + S.dist * sp * Math.sin(S.yaw), ty + S.dist * Math.cos(S.pitch), tz + S.dist * sp * Math.cos(S.yaw));
            lookGoal.set(tx, ty, tz);
        } else if (S.camMode === 'hood') {
            camGoal.set(cx, 1.42, CAR_Z - 0.9);
            lookGoal.set(cx + Math.sin(S.yaw) * 30, 1.2, CAR_Z - 40);
        } else {
            camGoal.set(cx * 0.4, 46, CAR_Z + 6);
            lookGoal.set(cx * 0.4, 0, CAR_Z - 20);
        }
        const k = 1 - Math.exp(-7 * dt);
        camera.position.lerp(camGoal, k); lookNow.lerp(lookGoal, k);
        camera.fov += ((S.camMode === 'hood' ? 66 : S.camMode === 'top' ? 48 : 52) - camera.fov) * k;
        camera.updateProjectionMatrix();
        camera.lookAt(lookNow);
    }
    function onResize() {
        if (!renderer) return;
        const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
        camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    }

    /* ======================================================== MAIN LOOP === */
    const _v = new T.Vector3();
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.05); S.time += dt;

        if (Math.abs(S.nightTarget - S.night) > 0.001) {
            S.night += Math.sign(S.nightTarget - S.night) * Math.min(Math.abs(S.nightTarget - S.night), dt * 0.9);
            applyNight(S.night);
        }
        evaluate(dt);

        /* السرعة (تسارع/كبح محدود) */
        const before = S.speed;
        if (S.target < S.speed) S.speed = Math.max(S.target, S.speed - 38 * dt);
        else S.speed = Math.min(S.target, S.speed + 14 * dt);
        const decel = (before - S.speed) / Math.max(dt, 1e-4);
        S.braking = S.speed > 0.5 ? (S.target < S.speed - 1) : S.target < 1;
        updateSpeedometerUI(S.speed);

        const adv = S.speed * K * dt;

        /* العالم */
        segments.forEach(function (s) {
            s.position.z += adv;
            if (s.position.z > CAR_Z + 90) s.position.z -= SEG_N * SEG_LEN;
        });

        /* السيارة الرئيسية */
        S.laneX += (S.laneTarget - S.laneX) * (1 - Math.exp(-2.4 * dt));
        const laneErr = S.laneTarget - S.laneX;
        ego.group.position.x = S.laneX;
        ego.group.rotation.y = -laneErr * 0.07;
        ego.steer(-laneErr * 0.18);
        ego.group.rotation.x += ((-Math.min(0.04, decel * 0.0012)) - ego.group.rotation.x) * 0.15;
        ego.group.position.y = Math.sin(S.time * 18) * 0.004 * Math.min(1, S.speed / 60);
        ego.roll(adv); ego.setBrake(S.braking ? 1 : 0);

        /* الكاميرا والظلال تتبع السيارة */
        shadowTarget.position.set(S.laneX * 0.5, 0, CAR_Z - 12);
        applyShadowFollow();

        /* مرور المركبات المعاكسة */
        ambient.forEach(function (a) {
            const mv = (S.speed + 45) * K * dt;
            a.z += mv; a.car.roll(mv);
            if (a.z > CAR_Z + 40) { a.z = -250 - Math.random() * 90; }
            a.car.group.position.z = a.z;
        });

        /* العناصر المسقطة */
        for (let i = S.placed.length - 1; i >= 0; i--) {
            const rec = S.placed[i];
            if (!rec.dragging) {
                if (rec.type === 'vehicle') {
                    const rel = rec.oncoming ? (S.speed + rec.own) : (S.speed - rec.own);
                    rec.z += rel * K * dt;
                    if (rec.model.car) rec.model.car.roll(Math.abs(rec.own) * K * dt);
                } else rec.z += adv;
                if (rec.type === 'pedestrian' && rec.walking) rec.x += rec.dir * 1.35 * dt;
            }
            if (rec.type === 'pedestrian') {
                rec.model.ped.update(dt, rec.walking && !rec.dragging);
                if (rec.walking) rec.group.rotation.y = rec.dir * Math.PI / 2;
            }
            if (rec.type === 'pedestrian') rec.group.position.y = Math.abs(rec.x) > 7.9 ? 0.2 : 0;
            if (rec.model.update) rec.model.update(dt);
            if (rec.model.car && rec.type === 'vehicle') rec.model.car.setBrake(!rec.oncoming && S.speed < 35 ? 1 : 0);
            rec.group.position.x = rec.x; rec.group.position.z = rec.z;
            if (rec.z > CAR_Z + 18 || rec.z < -330) removeRec(rec, true);
        }

        /* حلقة التحديد + بطاقة الاسم */
        const sel = S.selected, lbl = document.getElementById('obj-label');
        if (sel && S.placed.indexOf(sel) >= 0) {
            ringMesh.visible = true;
            const rad = sel.model.radius * (sel.type === 'zebra' ? 0.0 : 1);
            ringMesh.visible = sel.type !== 'zebra';
            ringMesh.scale.setScalar(Math.max(0.8, rad) * (1 + Math.sin(S.time * 4) * 0.04));
            ringMesh.position.set(sel.x, 0.09, sel.z);
            _v.set(sel.x, 3.4, sel.z).project(camera);
            const r = renderer.domElement.getBoundingClientRect();
            lbl.style.left = ((_v.x * 0.5 + 0.5) * r.width) + 'px'; lbl.style.top = ((-_v.y * 0.5 + 0.5) * r.height) + 'px';
            lbl.style.opacity = _v.z < 1 ? 1 : 0;
            lbl.innerText = sel.name + ' • ' + Math.max(0, Math.round(CAR_Z - 2.35 - sel.z)) + ' م';
        } else { ringMesh.visible = false; if (lbl) lbl.style.opacity = 0; }

        /* وميض أضواء التحذير فوق الأبراج */
        const blink = (Math.sin(S.time * 3) > 0 ? 1 : 0.1) * S.night * 4;
        S.beacons.forEach(function (b) { b.emissiveIntensity = blink; });

        updateCamera(dt);
        renderer.render(scene, camera);
        if (++S.frame === 45) autoRepair();
    }

    /* إن كان المشهد النهاري أسود بالكامل (مشكلة PBR/GPU) → إعادة التحميل بالوضع الآمن */
    function autoRepair() {
        if (S.night > 0.01) return;
        const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(4);
        let lit = 0;
        [[0.5, 0.12], [0.4, 0.2], [0.6, 0.2], [0.5, 0.3]].forEach(function (p) {
            gl.readPixels(Math.floor(W * p[0]), Math.floor(H * p[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            lit += px[0] + px[1] + px[2];
        });
        if (lit > 12) return;
        if (!/[?&]safe=1/.test(location.search)) {
            console.warn('Scene rendered black — reloading in safe mode (Lambert materials)');
            location.search = '?safe=1';
        } else {
            showToast('المشهد ما زال مظلماً — افتح Console (F12) وأرسل الأخطاء الظاهرة', 'fa-triangle-exclamation');
        }
    }
    function applyShadowFollow() {
        const e = S.night; const e2 = e * e * (3 - 2 * e);
        const sp = new T.Vector3(55, 85, 35).lerp(new T.Vector3(-45, 70, 20), e2);
        sun.position.copy(sp).add(shadowTarget.position);
        sunSprite.position.set(55, 85, 35).multiplyScalar(5.2).add(camera.position);
        moonSprite.position.set(-45, 70, 20).multiplyScalar(5.2).add(camera.position);
        skyDome.position.copy(camera.position); stars.position.copy(camera.position);
    }

    /* ====================================================== BACKEND API === */
    function timeoutFetch(url, opt, ms) {
        const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, ms);
        return fetch(url, Object.assign({ signal: c.signal }, opt || {})).finally(function () { clearTimeout(t); });
    }
    function checkBackend() {
        if (location.protocol === 'file:' && false) return;
        timeoutFetch(API + '/api/health', {}, 1200).then(function (r) { return r.json(); })
            .then(function () { setBackend(true); }).catch(function () { setBackend(false); });
    }
    function setBackend(ok) {
        S.backend = ok;
        const el = document.getElementById('backend-status'); if (!el) return;
        el.className = 'flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-full border ' + (ok ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-gray-400 border-gray-600/50 bg-gray-700/20');
        el.querySelector('span').innerText = ok ? 'Python/OpenCV متصل' : 'وضع مستقل (JS)';
    }
    function sendBackend(rec) {
        if (!S.backend) return;
        timeoutFetch(API + '/api/process-object', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ object_type: rec.type, object_name: rec.name })
        }, 2000).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.telemetry) showToast('FastAPI: ' + j.telemetry.message_ar, 'fa-server');
        }).catch(function () { setBackend(false); });
    }

    /* ============================================ OPENCV 2x2 PIPELINE UI == */
    const PW = 300, PH = 180;
    function runPipeline(type) {
        const src = document.createElement('canvas'); src.width = PW; src.height = PH;
        const sctx = src.getContext('2d');
        TSRPipeline.drawFrame(sctx, PW, PH, type);
        const ids = ['orig', 'clahe', 'mask', 'isolated'].map(function (k) {
            const c = document.getElementById('cv-canvas-' + k); c.width = PW; c.height = PH; return c.getContext('2d');
        });
        ids[0].drawImage(src, 0, 0);
        const label = document.getElementById('pipeline-source'), stats = document.getElementById('pipeline-stats');

        const local = function () {
            const img = sctx.getImageData(0, 0, PW, PH);
            const out = TSRPipeline.run(img.data, PW, PH, { gx: 8, gy: 8, clip: 3.0 });
            ids[1].putImageData(new ImageData(out.enhanced, PW, PH), 0, 0);
            ids[2].putImageData(new ImageData(out.mask, PW, PH), 0, 0);
            ids[3].putImageData(new ImageData(out.isolated, PW, PH), 0, 0);
            drawBox(ids[3], out.bbox, out.maskPixels);
            label.innerText = 'المصدر: معالجة محلية (JavaScript — نفس الخوارزمية)';
            stats.innerText = 'mask_pixels = ' + out.maskPixels;
        };
        if (!S.backend) { local(); return; }
        src.toBlob(function (blob) {
            const fd = new FormData(); fd.append('file', blob, 'frame.png');
            timeoutFetch(API + '/api/preprocess-frame', { method: 'POST', body: fd }, 4000)
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    const names = ['clahe', 'mask', 'isolated'];
                    return Promise.all(names.map(function (n, i) {
                        return new Promise(function (res) {
                            const im = new Image(); im.onload = function () { ids[i + 1].drawImage(im, 0, 0, PW, PH); res(); };
                            im.src = 'data:image/png;base64,' + j.stages[n];
                        });
                    })).then(function () {
                        drawBox(ids[3], j.bbox, j.mask_pixels);
                        label.innerText = 'المصدر: Python / OpenCV (FastAPI)';
                        stats.innerText = 'mask_pixels = ' + j.mask_pixels;
                    });
                }).catch(function () { setBackend(false); local(); });
        }, 'image/png');
    }
    function drawBox(ctx, bb, count) {
        ctx.lineWidth = 2.5; ctx.font = 'bold 13px Arial';
        if (bb) {
            ctx.strokeStyle = '#22c55e'; ctx.strokeRect(bb.x - 4, bb.y - 4, bb.w + 8, bb.h + 8);
            ctx.fillStyle = '#22c55e'; ctx.fillText('sign ' + Math.min(99, Math.round(88 + Math.min(10, count / 600))) + '%', bb.x - 4, Math.max(12, bb.y - 8));
        } else { ctx.fillStyle = '#94a3b8'; ctx.fillText('لا توجد منطقة حمراء', 12, 22); }
    }

    /* ================================================================ UI == */
    function togglePipelineModal() { document.getElementById('pipeline-modal').classList.toggle('hidden'); }
    function resetSimulation() {
        S.placed.slice().forEach(function (r) { removeRec(r, true); });
        S.speed = CRUISE; S.laneX = EGO_LANE; lastReaction = '';
        showToast('تمت إعادة ضبط المحاكاة', 'fa-rotate-right');
    }
    function bindUI() {
        const cards = document.querySelectorAll('.draggable-card'), zone = document.getElementById('viewport-container');
        const overlay = document.getElementById('drop-zone-overlay');
        cards.forEach(function (card) {
            card.addEventListener('dragstart', function (e) {
                e.dataTransfer.setData('application/json', JSON.stringify({ type: card.dataset.type }));
                e.dataTransfer.effectAllowed = 'copy'; overlay.classList.remove('opacity-0');
            });
            card.addEventListener('dragend', function () { overlay.classList.add('opacity-0'); });
            card.addEventListener('click', function () { spawn(card.dataset.type, card.dataset.type === 'pedestrian' ? 8.9 : EGO_LANE, -42); });
        });
        zone.addEventListener('dragover', function (e) { e.preventDefault(); });
        zone.addEventListener('drop', function (e) {
            e.preventDefault(); overlay.classList.add('opacity-0');
            const raw = e.dataTransfer.getData('application/json'); if (!raw) return;
            const data = JSON.parse(raw), p = groundPoint(e);
            spawn(data.type, p ? p.x : EGO_LANE, p ? p.z : -42);
        });
        document.querySelectorAll('[data-cam]').forEach(function (b) { b.addEventListener('click', function () { setCam(b.dataset.cam); }); });
        setCam('chase');
    }

    window.toggleNight = toggleNight; window.togglePipelineModal = togglePipelineModal;
    window.resetSimulation = resetSimulation; window.simulateOpenCVPipeline = runPipeline;
    window.deleteSelected = function () { if (S.selected) removeRec(S.selected); };
    window.__sim = { S: S, spawn: spawn, evaluate: evaluate };

    window.addEventListener('error', function (e) { console.error(e.message); try { showToast('خطأ: ' + e.message, 'fa-triangle-exclamation'); } catch (_) {} });
    window.addEventListener('load', init);
})();
