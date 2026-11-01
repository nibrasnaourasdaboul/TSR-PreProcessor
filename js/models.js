/* ==========================================================================
 *  models.js  —  مكتبة المجسمات ثلاثية الأبعاد (Procedural 3D Model Library)
 *  كل مجسم يُبنى من هندسة حقيقية (Extrude / Lathe / Torus ...) مع خامات PBR
 *  وتوابع setNight() و update() ليتفاعل مع النهار/الليل والحركة.
 *
 *  لاستبدال أي مجسم بنموذج احترافي من Spline:  Export → GLB ثم ضعه في
 *  assets/models/<type>.glb  (انظر README  — يُحمَّل تلقائياً إن وُجد).
 * ========================================================================== */
(function () {
    const T = THREE;

    /* ---------------------------------------------------------------- utils */
    function rng(seed) {                       // مولّد عشوائي ثابت (mulberry32)
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function canvasTex(w, h, draw, opts) {
        opts = opts || {};
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        draw(c.getContext('2d'), w, h);
        const t = new T.CanvasTexture(c);
        t.encoding = T.sRGBEncoding;
        t.anisotropy = 8;
        if (opts.repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    }

    function std(color, o) {
        return new T.MeshStandardMaterial(Object.assign({ color: color, roughness: 0.6, metalness: 0.0 }, o || {}));
    }

    function mesh(geo, mat, x, y, z, shadow) {
        const m = new T.Mesh(geo, mat);
        m.position.set(x || 0, y || 0, z || 0);
        if (shadow !== false) { m.castShadow = true; m.receiveShadow = true; }
        return m;
    }

    function radialTex(r, g, b) {              // بقعة ضوء ناعمة (للإضاءة على الأرض)
        return canvasTex(128, 128, function (ctx, w, h) {
            const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
            gr.addColorStop(0, 'rgba(' + r + ',' + g + ',' + b + ',1)');
            gr.addColorStop(0.35, 'rgba(' + r + ',' + g + ',' + b + ',0.45)');
            gr.addColorStop(1, 'rgba(' + r + ',' + g + ',' + b + ',0)');
            ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
        });
    }

    /* shared materials */
    const M = {
        metal: std(0x9aa3ad, { metalness: 0.45, roughness: 0.4 }),
        darkMetal: std(0x2a2f36, { metalness: 0.4, roughness: 0.45 }),
        rubber: std(0x0d0d0e, { roughness: 0.92 }),
        black: std(0x0b0b0c, { roughness: 0.55 }),
        chrome: std(0xd8dce2, { metalness: 0.55, roughness: 0.25 })
    };

    /* ============================================================== CAR === */
    function buildCar(o) {
        o = o || {};
        const color = o.color !== undefined ? o.color : 0x1e4fd8;
        const W = 1.84;
        const g = new T.Group();

        const paint = new T.MeshPhysicalMaterial({
            color: color, metalness: 0.2, roughness: 0.32,
            clearcoat: 1.0, clearcoatRoughness: 0.05
        });
        const glass = new T.MeshPhysicalMaterial({
            color: 0x1c2b3a, metalness: 0.15, roughness: 0.06,
            clearcoat: 1.0, clearcoatRoughness: 0.02
        });

        function extrude(shape, depth, bevel) {
            const geo = new T.ExtrudeGeometry(shape, {
                depth: depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
                bevelSegments: 3, curveSegments: 16
            });
            geo.translate(0, 0, -depth / 2);
            return geo;
        }

        /* الجسم السفلي (مقطع جانبي: u = طول السيارة، v = الارتفاع) */
        const s = new T.Shape();
        s.moveTo(-2.25, 0.34);
        s.lineTo(2.2, 0.34);
        s.quadraticCurveTo(2.34, 0.36, 2.32, 0.58);
        s.lineTo(2.26, 0.72);
        s.quadraticCurveTo(2.1, 0.9, 1.6, 0.93);
        s.lineTo(0.95, 0.99);
        s.lineTo(-1.6, 1.01);
        s.quadraticCurveTo(-2.16, 1.0, -2.28, 0.84);
        s.lineTo(-2.31, 0.58);
        s.quadraticCurveTo(-2.31, 0.36, -2.25, 0.34);
        const body = new T.Mesh(extrude(s, W - 0.08, 0.04), paint);
        body.rotation.y = Math.PI / 2;
        body.castShadow = true; body.receiveShadow = true;
        g.add(body);

        /* الكابينة الزجاجية */
        const gs = new T.Shape();
        gs.moveTo(1.02, 0.9);
        gs.lineTo(0.44, 1.4);
        gs.quadraticCurveTo(0.36, 1.46, 0.2, 1.46);
        gs.lineTo(-0.85, 1.46);
        gs.quadraticCurveTo(-1.02, 1.46, -1.14, 1.37);
        gs.lineTo(-1.64, 0.96);
        gs.lineTo(-1.64, 0.9);
        gs.closePath();
        const cabin = new T.Mesh(extrude(gs, 1.5, 0.035), glass);
        cabin.rotation.y = Math.PI / 2; cabin.castShadow = true;
        g.add(cabin);

        /* السقف والأعمدة */
        g.add(mesh(new T.BoxGeometry(1.5, 0.05, 1.3), paint, 0, 1.485, 0.3));
        function pillar(len, cy, cz, rotX, x) {
            const p = mesh(new T.BoxGeometry(0.07, 0.055, len), paint, x, cy, cz);
            p.rotation.x = rotX; return p;
        }
        [-0.8, 0.8].forEach(function (x) {
            g.add(pillar(0.74, 1.175, -0.71, -0.659, x));  // A
            g.add(pillar(0.91, 1.22, 1.235, 0.558, x));    // C
        });

        /* المرايا */
        [-1, 1].forEach(function (sx) {
            g.add(mesh(new T.BoxGeometry(0.2, 0.11, 0.13), paint, sx * 1.0, 1.04, -0.8));
            g.add(mesh(new T.BoxGeometry(0.1, 0.03, 0.03), M.black, sx * 0.92, 1.0, -0.8, false));
        });

        /* الواجهة الأمامية والخلفية */
        g.add(mesh(new T.BoxGeometry(0.95, 0.17, 0.05), M.black, 0, 0.58, -2.385));     // شبك
        g.add(mesh(new T.BoxGeometry(0.97, 0.02, 0.055), M.chrome, 0, 0.675, -2.41, false));
        g.add(mesh(new T.BoxGeometry(1.4, 0.13, 0.06), M.black, 0, 0.42, -2.385));      // فتحة سفلية
        g.add(mesh(new T.BoxGeometry(1.84, 0.08, 0.1), M.black, 0, 0.35, -2.3));       // مصدّ
        g.add(mesh(new T.BoxGeometry(1.84, 0.08, 0.1), M.black, 0, 0.36, 2.3));
        g.add(mesh(new T.BoxGeometry(0.52, 0.12, 0.02), std(0xf1f1f1, { roughness: 0.4 }), 0, 0.56, 2.385, false));
        g.add(mesh(new T.BoxGeometry(0.52, 0.12, 0.02), std(0xf1f1f1, { roughness: 0.4 }), 0, 0.3, -2.4, false));
        g.add(mesh(new T.BoxGeometry(1.7, 0.1, 4.3), M.black, 0, 0.29, 0, false));      // أسفل السيارة

        /* المصابيح */
        const headMat = new T.MeshStandardMaterial({ color: 0xe9f3ff, emissive: 0xcfe6ff, emissiveIntensity: 0.25, roughness: 0.1 });
        const tailMat = new T.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1010, emissiveIntensity: 0.35, roughness: 0.2 });
        [-1, 1].forEach(function (sx) {
            g.add(mesh(new T.BoxGeometry(0.56, 0.17, 0.07), M.black, sx * 0.66, 0.75, -2.33, false));
            const hl = mesh(new T.BoxGeometry(0.46, 0.085, 0.05), headMat, sx * 0.66, 0.76, -2.385, false);
            hl.rotation.y = sx * 0.12; g.add(hl);
            g.add(mesh(new T.BoxGeometry(0.2, 0.03, 0.05), headMat, sx * 0.66, 0.67, -2.385, false)); // DRL
            const tl = mesh(new T.BoxGeometry(0.5, 0.1, 0.05), tailMat, sx * 0.68, 0.84, 2.385, false);
            tl.rotation.y = -sx * 0.1; g.add(tl);
        });
        g.add(mesh(new T.BoxGeometry(0.7, 0.025, 0.04), tailMat, 0, 0.87, 2.385, false));

        /* الإطارات */
        const wheels = [], pivots = [];
        const tireGeo = new T.CylinderGeometry(0.36, 0.36, 0.25, 36); tireGeo.rotateZ(Math.PI / 2);
        const sideGeo = new T.TorusGeometry(0.3, 0.06, 10, 36); sideGeo.rotateY(Math.PI / 2);
        const rimGeo = new T.CylinderGeometry(0.245, 0.245, 0.27, 32); rimGeo.rotateZ(Math.PI / 2);
        const discGeo = new T.CylinderGeometry(0.2, 0.2, 0.03, 28); discGeo.rotateZ(Math.PI / 2);
        const capGeo = new T.CylinderGeometry(0.05, 0.05, 0.3, 14); capGeo.rotateZ(Math.PI / 2);
        const rimMat = std(0xb8bec7, { metalness: 0.5, roughness: 0.3 });
        const wheelPos = [[-1, -1.38], [1, -1.38], [-1, 1.38], [1, 1.38]];
        wheelPos.forEach(function (wp, i) {
            const sx = wp[0], z = wp[1];
            const pivot = new T.Group(); pivot.position.set(sx * 0.93, 0.36, z);
            const spin = new T.Group();
            spin.add(mesh(tireGeo, M.rubber, 0, 0, 0));
            spin.add(mesh(sideGeo, M.rubber, sx * 0.0, 0, 0, false));
            spin.add(mesh(rimGeo, rimMat, 0, 0, 0, false));
            spin.add(mesh(discGeo, std(0x6b7078, { metalness: 0.9, roughness: 0.4 }), -sx * 0.07, 0, 0, false));
            for (let k = 0; k < 5; k++) {
                const sp = mesh(new T.BoxGeometry(0.03, 0.46, 0.055), rimMat, sx * 0.125, 0, 0, false);
                sp.rotation.x = k * Math.PI / 5; spin.add(sp);   // 5 بلاطات كاملة القطر = 10 أذرع
            }
            spin.add(mesh(capGeo, M.chrome, sx * 0.01, 0, 0, false));
            pivot.add(spin); g.add(pivot);
            wheels.push(spin); if (i < 2) pivots.push(pivot);
            /* قوس العجلة (أسود) على جانب الهيكل */
            const arch = new T.Mesh(new T.CircleGeometry(0.43, 28), new T.MeshBasicMaterial({ color: 0x030303 }));
            arch.position.set(sx * 0.926, 0.37, z); arch.rotation.y = sx * Math.PI / 2; g.add(arch);
        });

        /* بقعة ضوء على الأرض + كشافات حقيقية */
        const poolMat = new T.MeshBasicMaterial({
            map: radialTex(255, 244, 214), transparent: true, opacity: 0,
            blending: T.AdditiveBlending, depthWrite: false
        });
        const pool = new T.Mesh(new T.PlaneGeometry(7, 17), poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.04, -11); pool.renderOrder = 3;
        g.add(pool);
        const spots = [];
        if (o.spots) {
            [-1, 1].forEach(function (sx) {
                const sp = new T.SpotLight(0xfff0d0, 0, 70, 0.52, 0.65, 1.3);
                sp.position.set(sx * 0.66, 0.78, -2.1);
                sp.target.position.set(sx * 0.5, 0, -28);
                g.add(sp); g.add(sp.target); spots.push(sp);
            });
        }

        const api = {
            group: g, wheels: wheels, frontPivots: pivots, brake: 0, night: 0,
            setNight: function (n) {
                api.night = n;
                headMat.emissiveIntensity = 0.25 + n * 3.2;
                poolMat.opacity = n * 0.85;
                spots.forEach(function (sp) { sp.intensity = n * 3.2; });
                api._tail();
            },
            setBrake: function (b) { api.brake = b; api._tail(); },
            _tail: function () { tailMat.emissiveIntensity = 0.35 + api.night * 0.9 + api.brake * 3.2; },
            roll: function (distance) {
                wheels.forEach(function (w) { w.rotation.x -= distance / 0.36; });
            },
            steer: function (a) { pivots.forEach(function (p) { p.rotation.y = a; }); }
        };
        return api;
    }

    /* ====================================================== SIGN TEXTURES == */
    function signTexture(type) {
        return canvasTex(512, 512, function (c, w, h) {
            const cx = w / 2, cy = h / 2;
            if (type === 'speed_limit') {
                c.fillStyle = '#f7f7f4'; c.beginPath(); c.arc(cx, cy, 250, 0, 7); c.fill();
                c.strokeStyle = '#d4101c'; c.lineWidth = 58; c.beginPath(); c.arc(cx, cy, 218, 0, 7); c.stroke();
                c.fillStyle = '#111'; c.font = '900 235px Arial, sans-serif';
                c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('30', cx, cy + 12);
            } else if (type === 'pass_right') {
                c.fillStyle = '#1f5fbf'; c.beginPath(); c.arc(cx, cy, 250, 0, 7); c.fill();
                c.strokeStyle = '#fff'; c.lineWidth = 16; c.beginPath(); c.arc(cx, cy, 232, 0, 7); c.stroke();
                c.fillStyle = '#fff'; c.save(); c.translate(cx, cy); c.rotate(Math.PI / 4);
                c.beginPath(); c.moveTo(-34, -170); c.lineTo(34, -170); c.lineTo(34, 40);
                c.lineTo(100, 40); c.lineTo(0, 170); c.lineTo(-100, 40); c.lineTo(-34, 40); c.closePath(); c.fill();
                c.restore();
            } else if (type === 'stop_sign') {
                const poly = function (r) {
                    c.beginPath();
                    for (let i = 0; i < 8; i++) {
                        const a = Math.PI / 8 + i * Math.PI / 4;
                        const px = cx + Math.cos(a) * r, py = cy - Math.sin(a) * r;
                        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
                    }
                    c.closePath();
                };
                c.fillStyle = '#ffffff'; poly(256); c.fill();
                c.fillStyle = '#c8101c'; poly(228); c.fill();
                c.fillStyle = '#fff'; c.font = '900 150px Arial, sans-serif';
                c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('STOP', cx, cy + 6);
            } else if (type === 'ped_sign') {
                c.fillStyle = '#1f5fbf'; c.fillRect(0, 0, w, h);
                c.fillStyle = '#fff'; c.fillRect(24, 24, w - 48, h - 48);
                c.fillStyle = '#1f5fbf'; c.fillRect(44, 44, w - 88, h - 88);
                c.fillStyle = '#fff'; c.beginPath(); c.moveTo(cx, 80); c.lineTo(w - 90, h - 110); c.lineTo(90, h - 110); c.closePath(); c.fill();
                c.fillStyle = '#111'; c.beginPath(); c.arc(cx, 220, 24, 0, 7); c.fill();
                c.fillRect(cx - 14, 250, 28, 90);
                c.lineWidth = 20; c.strokeStyle = '#111'; c.lineCap = 'round';
                c.beginPath(); c.moveTo(cx, 340); c.lineTo(cx - 36, 400); c.moveTo(cx, 340); c.lineTo(cx + 34, 400); c.stroke();
            }
        });
    }

    function pole(h, r) {
        return mesh(new T.CylinderGeometry(r || 0.05, (r || 0.05) * 1.15, h, 14), M.metal, 0, h / 2, 0);
    }

    function roundSign(type) {
        const grp = new T.Group();
        grp.add(pole(3.1));
        const cap = mesh(new T.SphereGeometry(0.06, 12, 8), M.metal, 0, 3.1, 0); grp.add(cap);
        const back = mesh(new T.CylinderGeometry(0.53, 0.53, 0.045, 48), M.metal, 0, 2.55, 0);
        back.rotation.x = Math.PI / 2; grp.add(back);
        const faceMat = new T.MeshStandardMaterial({
            map: signTexture(type), roughness: 0.35, metalness: 0.1,
            emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0
        });
        const face = new T.Mesh(new T.CircleGeometry(0.5, 64), faceMat);
        face.position.set(0, 2.55, 0.026); grp.add(face);
        const rim = mesh(new T.TorusGeometry(0.52, 0.018, 8, 64), M.metal, 0, 2.55, 0.02, false); grp.add(rim);
        [-0.18, 0.18].forEach(function (dy) {   // قطع التثبيت
            grp.add(mesh(new T.BoxGeometry(0.1, 0.03, 0.07), M.darkMetal, 0, 2.55 + dy, -0.05, false));
        });
        return { group: grp, faceMat: faceMat, radius: 0.9 };
    }

    function stopSign() {
        const grp = new T.Group();
        grp.add(pole(3.1));
        const back = mesh(new T.CylinderGeometry(0.58, 0.58, 0.04, 8), M.metal, 0, 2.55, 0);
        back.rotation.x = Math.PI / 2; back.rotation.z = Math.PI / 8; grp.add(back);
        const faceMat = new T.MeshStandardMaterial({ map: signTexture('stop_sign'), roughness: 0.35 });
        const face = new T.Mesh(new T.CircleGeometry(0.58, 8, Math.PI / 8), faceMat);
        // UV الدائرة ذات 8 أضلاع تطابق مضلع النسيج
        face.position.set(0, 2.55, 0.023); grp.add(face);
        return { group: grp, faceMat: faceMat, radius: 0.9 };
    }

    /* ================================================================ CONE */
    function trafficCone() {
        const grp = new T.Group();
        const R = function (y) { return 0.025 + (0.75 - y) * (0.165 - 0.025) / 0.69; };
        function lathe(y0, y1, off) {
            const pts = [];
            for (let i = 0; i <= 6; i++) { const y = y0 + (y1 - y0) * i / 6; pts.push(new T.Vector2(R(y) + off, y)); }
            return new T.LatheGeometry(pts, 36);
        }
        const orange = std(0xff5a0a, { roughness: 0.45, emissive: 0xff3a00, emissiveIntensity: 0 });
        const white = std(0xf6f6f2, { roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0 });
        const cone = mesh(lathe(0.06, 0.75, 0), orange, 0, 0, 0); grp.add(cone);
        grp.add(mesh(new T.SphereGeometry(0.03, 10, 8), orange, 0, 0.75, 0, false));
        grp.add(mesh(lathe(0.47, 0.6, 0.004), white, 0, 0, 0, false));
        grp.add(mesh(lathe(0.28, 0.4, 0.004), white, 0, 0, 0, false));
        const base = mesh(new T.BoxGeometry(0.42, 0.05, 0.42), std(0x161616, { roughness: 0.8 }), 0, 0.025, 0);
        grp.add(base);
        grp.add(mesh(new T.CylinderGeometry(0.17, 0.17, 0.04, 28), orange, 0, 0.065, 0, false));
        return { group: grp, mats: [orange, white], radius: 0.6 };
    }

    /* ======================================================== TRAFFIC LIGHT */
    function trafficLight() {
        const grp = new T.Group();
        const side = new T.Group();            // يُعكس للجهة اليسرى
        grp.add(side);
        side.add(pole(5.7, 0.09));
        side.add(mesh(new T.CylinderGeometry(0.17, 0.2, 0.25, 16), M.darkMetal, 0, 0.125, 0));
        const arm = mesh(new T.CylinderGeometry(0.06, 0.07, 5.2, 12), M.metal, -2.6, 5.4, 0);
        arm.rotation.z = Math.PI / 2; side.add(arm);

        const lamps = {};
        function housing(x, y, big) {
            const h = new T.Group(); h.position.set(x, y, 0);
            h.add(mesh(new T.BoxGeometry(0.46, 1.32, 0.38), std(0x14171c, { roughness: 0.5, metalness: 0.4 }), 0, 0, 0));
            h.add(mesh(new T.BoxGeometry(0.52, 1.38, 0.05), M.black, 0, 0, -0.17, false));
            const cols = [[0xff2a1a, 0.42, 'red'], [0xffb400, 0, 'yellow'], [0x1fe06a, -0.42, 'green']];
            const out = {};
            cols.forEach(function (cdef) {
                const m = new T.MeshStandardMaterial({ color: 0x1a1a1a, emissive: cdef[0], emissiveIntensity: 0, roughness: 0.2 });
                const lens = mesh(new T.CylinderGeometry(0.15, 0.15, 0.06, 28), m, 0, cdef[1], 0.2, false);
                lens.rotation.x = Math.PI / 2; h.add(lens);
                const hood = mesh(new T.CylinderGeometry(0.19, 0.19, 0.22, 20, 1, true, -Math.PI / 2, Math.PI), std(0x0c0d0f, { side: T.DoubleSide }), 0, cdef[1] + 0.03, 0.26, false);
                hood.rotation.x = Math.PI / 2; hood.rotation.z = Math.PI / 2; h.add(hood);
                out[cdef[2]] = { mat: m, color: cdef[0] };
            });
            return { group: h, lamps: out };
        }
        const main = housing(-5.0, 5.4);
        const small = housing(0.0, 3.0);        // مصباح ثانوي على العمود
        side.add(main.group); side.add(small.group);
        Object.keys(main.lamps).forEach(function (k) { lamps[k] = [main.lamps[k], small.lamps[k]]; });

        const api = {
            group: grp, radius: 1.3, state: 'red', timer: 0, side: side,
            setSide: function (s) { side.scale.x = s >= 0 ? 1 : -1; },
            setState: function (st) {
                api.state = st;
                ['red', 'yellow', 'green'].forEach(function (k) {
                    lamps[k].forEach(function (l) { l.mat.emissiveIntensity = (k === st) ? 3.2 : 0.02; });
                });
            },
            update: function (dt) {              // دورة: أحمر 6ث ← أخضر 5ث ← أصفر 1.5ث
                api.timer += dt;
                const dur = { red: 6, green: 5, yellow: 1.5 }[api.state];
                if (api.timer > dur) {
                    api.timer = 0;
                    api.setState(api.state === 'red' ? 'green' : api.state === 'green' ? 'yellow' : 'red');
                }
            }
        };
        api.setState('red');
        return api;
    }

    /* ============================================================ PEDESTRIAN */
    function pedestrian(seed) {
        const r = rng(seed || 7);
        const shirts = [0x7c3aed, 0xdb2777, 0x0ea5a5, 0xea580c, 0x2563eb];
        const skin = std(0xe0ac84, { roughness: 0.65 });
        const shirt = std(shirts[Math.floor(r() * shirts.length)], { roughness: 0.8 });
        const pants = std(0x1f2937, { roughness: 0.85 });
        const shoe = std(0x111111, { roughness: 0.6 });
        const hair = std(0x2b1b12, { roughness: 0.9 });
        const grp = new T.Group();
        const body = new T.Group(); grp.add(body);

        function cyl(r1, r2, h, mat) { return new T.CylinderGeometry(r1, r2, h, 14); }
        // الجذع
        const torso = mesh(new T.CylinderGeometry(0.2, 0.17, 0.6, 16), shirt, 0, 1.28, 0); body.add(torso);
        const chest = mesh(new T.SphereGeometry(0.2, 16, 12), shirt, 0, 1.55, 0); chest.scale.set(1, 0.55, 0.7); body.add(chest);
        const hips = mesh(new T.CylinderGeometry(0.17, 0.18, 0.2, 16), pants, 0, 0.93, 0); body.add(hips);
        body.add(mesh(cyl(0.06, 0.07, 0.12), skin, 0, 1.66, 0));
        const head = mesh(new T.SphereGeometry(0.115, 20, 16), skin, 0, 1.79, 0); head.scale.set(0.9, 1.05, 1); body.add(head);
        const cap = mesh(new T.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 1.805, -0.01); body.add(cap);

        function limb(x, y, upLen, loLen, upMat, loMat, endMesh) {
            const top = new T.Group(); top.position.set(x, y, 0);
            top.add(mesh(cyl(0.065, 0.055, upLen), upMat, 0, -upLen / 2, 0));
            const knee = new T.Group(); knee.position.y = -upLen; top.add(knee);
            knee.add(mesh(new T.SphereGeometry(0.058, 10, 8), upMat, 0, 0, 0, false));
            knee.add(mesh(cyl(0.055, 0.04, loLen), loMat, 0, -loLen / 2, 0));
            if (endMesh) { endMesh.position.y = -loLen; knee.add(endMesh); }
            return { top: top, knee: knee };
        }
        const legL = limb(-0.09, 0.9, 0.44, 0.42, pants, pants, mesh(new T.BoxGeometry(0.1, 0.07, 0.24), shoe, 0, 0, 0.05));
        const legR = limb(0.09, 0.9, 0.44, 0.42, pants, pants, mesh(new T.BoxGeometry(0.1, 0.07, 0.24), shoe, 0, 0, 0.05));
        const armL = limb(-0.26, 1.52, 0.3, 0.28, shirt, skin, mesh(new T.SphereGeometry(0.05, 10, 8), skin, 0, 0, 0));
        const armR = limb(0.26, 1.52, 0.3, 0.28, shirt, skin, mesh(new T.SphereGeometry(0.05, 10, 8), skin, 0, 0, 0));
        [legL, legR, armL, armR].forEach(function (l) { body.add(l.top); });

        let t = r() * 6;
        const api = {
            group: grp, radius: 0.7, moving: false,
            update: function (dt, walking) {
                if (walking) t += dt * 5.2;
                const sw = walking ? Math.sin(t) : 0, sw2 = walking ? Math.sin(t + Math.PI) : 0;
                legL.top.rotation.x = sw * 0.6;  legL.knee.rotation.x = walking ? Math.max(0, -Math.sin(t)) * 0.8 : 0;
                legR.top.rotation.x = sw2 * 0.6; legR.knee.rotation.x = walking ? Math.max(0, -Math.sin(t + Math.PI)) * 0.8 : 0;
                armL.top.rotation.x = sw2 * 0.5; armR.top.rotation.x = sw * 0.5;
                armL.knee.rotation.x = -0.3;      armR.knee.rotation.x = -0.3;
                body.position.y = walking ? Math.abs(Math.sin(t)) * 0.035 : 0;
                body.rotation.z = walking ? Math.sin(t) * 0.02 : 0;
            }
        };
        return api;
    }

    /* ============================================================ CROSSWALK */
    function crosswalkTexture() {
        return canvasTex(1024, 256, function (c, w, h) {
            c.clearRect(0, 0, w, h);
            const n = 15, bw = w / (n * 2 - 1);
            for (let i = 0; i < n; i++) {
                c.fillStyle = 'rgba(244,244,240,0.96)';
                c.fillRect(i * bw * 2, 0, bw, h);
            }
            // تآكل خفيف
            for (let i = 0; i < 1800; i++) {
                c.fillStyle = 'rgba(40,42,46,' + (Math.random() * 0.35) + ')';
                c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 2 + Math.random() * 4);
            }
        });
    }
    let _zebraTex = null;
    function zebra() {
        const grp = new T.Group();
        if (!_zebraTex) _zebraTex = crosswalkTexture();
        const m = new T.MeshStandardMaterial({
            map: _zebraTex, transparent: true, roughness: 0.8, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        });
        const p = new T.Mesh(new T.PlaneGeometry(15.0, 3.6), m);
        p.rotation.x = -Math.PI / 2; p.position.y = 0.02; p.receiveShadow = true; grp.add(p);
        [-1, 1].forEach(function (sx) {               // لافتة ممر المشاة
            const s = new T.Group(); s.position.set(sx * 8.9, 0, 2.2);
            s.add(pole(2.9, 0.045));
            const fm = new T.MeshStandardMaterial({ map: signTexture('ped_sign'), roughness: 0.35 });
            const face = new T.Mesh(new T.PlaneGeometry(0.75, 0.75), fm); face.position.set(0, 2.5, 0.03); s.add(face);
            s.add(mesh(new T.BoxGeometry(0.8, 0.8, 0.04), M.metal, 0, 2.5, 0));
            grp.add(s);
        });
        return { group: grp, radius: 8.5 };
    }

    /* ============================================================= BUILDINGS */
    const CELL_W = 12.8, CELL_H = 13.6;           // 4 نوافذ × 4 طوابق
    const _wallCache = {};
    function wallTextures(style) {
        if (_wallCache[style]) return _wallCache[style];
        const S = 512, r = rng(1000 + style * 31);
        const walls = ['#6d8097', '#cfc6b8', '#8d4d3c', '#d8c8a8', '#2c3644', '#e7e8ea'];
        const lit = ['#ffd9a0', '#ffe9be', '#fff3d6', '#cfe4ff', '#ffc98a'];
        const map = canvasTex(S, S, function (c) {
            c.fillStyle = walls[style]; c.fillRect(0, 0, S, S);
            if (style === 2) {                        // طوب
                c.strokeStyle = 'rgba(0,0,0,0.18)'; c.lineWidth = 2;
                for (let y = 0; y < S; y += 12) {
                    c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke();
                    for (let x = (y / 12 % 2) * 12; x < S; x += 24) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 12); c.stroke(); }
                }
            }
            for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
                const x = col * 128, y = row * 128;
                if (style === 0 || style === 4) {     // واجهة زجاجية
                    const gr = c.createLinearGradient(x, y, x + 128, y + 128);
                    gr.addColorStop(0, style === 0 ? '#9fc4e6' : '#16212e');
                    gr.addColorStop(1, style === 0 ? '#3c5f84' : '#0b121b');
                    c.fillStyle = gr; c.fillRect(x + 4, y + 14, 120, 96);
                    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 4, y + 14, 120, 6);
                } else {
                    c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 22, y + 22, 84, 82);
                    const gr = c.createLinearGradient(x, y, x + 100, y + 100);
                    gr.addColorStop(0, '#7ea0c2'); gr.addColorStop(1, '#2d4560');
                    c.fillStyle = gr; c.fillRect(x + 26, y + 26, 76, 74);
                    c.fillStyle = style === 3 ? '#8a6f4a' : '#f4f4f1';          // إطار وعتبة
                    c.fillRect(x + 62, y + 26, 4, 74); c.fillRect(x + 20, y + 100, 88, 8);
                    if (style === 1) { c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x + 8, y + 110, 112, 8); }  // شرفة
                }
            }
            c.fillStyle = 'rgba(0,0,0,0.04)';
            for (let i = 0; i < 1200; i++) c.fillRect(r() * S, r() * S, 3, 3);
        }, { repeat: true });
        const emis = canvasTex(S, S, function (c) {
            c.fillStyle = '#000'; c.fillRect(0, 0, S, S);
            for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
                if (r() < 0.52) {
                    c.fillStyle = lit[Math.floor(r() * lit.length)];
                    const x = col * 128, y = row * 128;
                    if (style === 0 || style === 4) c.fillRect(x + 4, y + 14, 120, 96);
                    else c.fillRect(x + 26, y + 26, 76, 74);
                }
            }
        }, { repeat: true });
        return (_wallCache[style] = { map: map, emis: emis });
    }

    let _shopTex = null;
    function shopTextures() {
        if (_shopTex) return _shopTex;
        const awn = ['#c0392b', '#2471a3', '#1e8449', '#d68910', '#7d3c98'];
        const map = canvasTex(512, 256, function (c, w, h) {
            c.fillStyle = '#23272e'; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 3; i++) {
                const x = i * 170 + 6;
                c.fillStyle = awn[(i * 2) % awn.length]; c.fillRect(x, 20, 158, 38);
                c.fillStyle = 'rgba(255,255,255,0.15)';
                for (let s = 0; s < 8; s++) c.fillRect(x + s * 20, 20, 10, 38);
                const gr = c.createLinearGradient(x, 70, x + 158, 220);
                gr.addColorStop(0, '#9ec1de'); gr.addColorStop(1, '#2f4a63');
                c.fillStyle = gr; c.fillRect(x, 70, 158, 150);
                c.fillStyle = '#10141a'; c.fillRect(x + 62, 130, 34, 90);   // باب
            }
        }, { repeat: true });
        const emis = canvasTex(512, 256, function (c, w, h) {
            c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
            for (let i = 0; i < 3; i++) {
                const x = i * 170 + 6;
                c.fillStyle = '#ffd9a0'; c.fillRect(x, 70, 158, 150);
                c.fillStyle = '#ffffff'; c.fillRect(x + 20, 28, 118, 18);
                c.fillStyle = '#000'; c.fillRect(x + 62, 130, 34, 90);
            }
        }, { repeat: true });
        return (_shopTex = { map: map, emis: emis });
    }

    /**
     * مبنى كامل: قاعدة محلات + برج + سطح بتفاصيل
     * @param {object} p {w,d,h,style,seed}  w=الاتساع على z ، d=العمق على x
     * @returns {{group, nightMats[]}}
     */
    function building(p) {
        const r = rng(p.seed || 1), g = new T.Group(), nightMats = [];
        const wt = wallTextures(p.style), st = shopTextures();

        function facadeMat(map, emis, rx, ry, envI) {
            const m = map.clone(); m.needsUpdate = true; m.repeat.set(rx, ry);
            const e = emis.clone(); e.needsUpdate = true; e.repeat.set(rx, ry);
            const mat = new T.MeshStandardMaterial({
                map: m, emissiveMap: e, emissive: 0xffffff, emissiveIntensity: 0,
                roughness: (p.style === 0 || p.style === 4) ? 0.25 : 0.75,
                metalness: (p.style === 0 || p.style === 4) ? 0.12 : 0.05, envMapIntensity: envI
            });
            nightMats.push(mat); return mat;
        }
        const roofMat = std(0x4b4f55, { roughness: 0.9 });
        const dark = std(0x16181b);

        function box(bx, by, bz, y, style) {
            const sideMat = facadeMat(wt.map, wt.emis, bz / CELL_W, by / CELL_H, 0.8);
            const frontMat = facadeMat(wt.map, wt.emis, bx / CELL_W, by / CELL_H, 0.8);
            const mats = [sideMat, sideMat, roofMat, dark, frontMat, frontMat];
            const m = new T.Mesh(new T.BoxGeometry(bx, by, bz), mats);
            m.position.y = y + by / 2; m.castShadow = true; m.receiveShadow = true; return m;
        }

        const shopH = 5.6;
        const podium = new T.Mesh(
            new T.BoxGeometry(p.d, shopH, p.w),
            (function () {
                const a = facadeMat(st.map, st.emis, p.w / CELL_W, 1, 0.5);
                const b = facadeMat(st.map, st.emis, p.d / CELL_W, 1, 0.5);
                return [a, a, roofMat, dark, b, b];
            })());
        podium.position.y = shopH / 2; podium.castShadow = podium.receiveShadow = true; g.add(podium);

        let top = shopH, bx = p.d, bz = p.w;
        const tiers = p.h > 45 ? 2 : 1;
        for (let t = 0; t < tiers; t++) {
            const th = t === 0 ? (p.h - shopH) * (tiers === 2 ? 0.62 : 1) : (p.h - shopH) * 0.38;
            const hh = Math.max(4, Math.round(th / 3.4) * 3.4);
            const bld = box(bx, hh, bz, top);
            g.add(bld);
            // كرنيش
            g.add(mesh(new T.BoxGeometry(bx + 0.5, 0.35, bz + 0.5), std(0xbdbdb8, { roughness: 0.8 }), 0, top + hh + 0.17, 0));
            top += hh;
            if (t === 0 && tiers === 2) { bx *= 0.68; bz *= 0.78; }
        }
        /* تفاصيل السطح */
        const nUnits = 2 + Math.floor(r() * 3);
        for (let i = 0; i < nUnits; i++) {
            const ux = (r() - 0.5) * bx * 0.6, uz = (r() - 0.5) * bz * 0.6;
            g.add(mesh(new T.BoxGeometry(1.6 + r() * 1.4, 1.1, 1.4 + r()), std(0x8d9299, { metalness: 0.5, roughness: 0.5 }), ux, top + 0.7, uz));
        }
        if (r() > 0.4) {
            const tank = new T.Group(); tank.position.set((r() - 0.5) * bx * 0.4, top, (r() - 0.5) * bz * 0.4);
            tank.add(mesh(new T.CylinderGeometry(1.1, 1.1, 2.2, 18), std(0x6b4a33, { roughness: 0.9 }), 0, 2.3, 0));
            tank.add(mesh(new T.ConeGeometry(1.25, 0.8, 18), std(0x4a3426), 0, 3.8, 0));
            for (let k = 0; k < 4; k++) {
                const a = k * Math.PI / 2 + Math.PI / 4;
                tank.add(mesh(new T.CylinderGeometry(0.06, 0.06, 1.4, 6), M.darkMetal, Math.cos(a) * 0.8, 0.7, Math.sin(a) * 0.8, false));
            }
            g.add(tank);
        }
        let beacon = null;
        if (p.h > 40) {                                  // هوائي + ضوء تحذير أحمر
            g.add(mesh(new T.CylinderGeometry(0.06, 0.12, 9, 8), M.darkMetal, 0, top + 4.5, 0, false));
            beacon = new T.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1a1a, emissiveIntensity: 0 });
            g.add(mesh(new T.SphereGeometry(0.22, 10, 8), beacon, 0, top + 9.1, 0, false));
        }
        return { group: g, nightMats: nightMats, beacon: beacon, height: top };
    }

    /* ================================================================= TREES */
    function tree(seed) {
        const r = rng(seed || 3), g = new T.Group();
        const bark = std(0x5a3d28, { roughness: 0.95 });
        const th = 2.2 + r() * 0.8;
        g.add(mesh(new T.CylinderGeometry(0.14, 0.24, th, 10), bark, 0, th / 2, 0));
        g.add(mesh(new T.CylinderGeometry(0.34, 0.4, 0.16, 12), std(0x3a3d41, { roughness: 0.9 }), 0, 0.08, 0)); // حوض
        const greens = [0x2f7d32, 0x3a8f3d, 0x276a2b, 0x4a9a3c];
        const blobs = 6 + Math.floor(r() * 3);
        for (let i = 0; i < blobs; i++) {
            const rad = 1.0 + r() * 0.8;
            const m = mesh(new T.IcosahedronGeometry(rad, 1),
                std(greens[Math.floor(r() * greens.length)], { roughness: 0.85, flatShading: true }),
                (r() - 0.5) * 2.2, th + 0.8 + r() * 2.2, (r() - 0.5) * 2.2);
            g.add(m);
        }
        return g;
    }

    /* ============================================================= STREET LAMP */
    function streetLamp(side, headMat) {                // side: +1 يمين ، -1 يسار
        const g = new T.Group();
        g.add(mesh(new T.CylinderGeometry(0.07, 0.12, 7.6, 12), std(0x30353b, { metalness: 0.7, roughness: 0.4 }), 0, 3.8, 0));
        g.add(mesh(new T.CylinderGeometry(0.2, 0.24, 0.3, 12), std(0x30353b, { metalness: 0.7 }), 0, 0.15, 0));
        const arm = mesh(new T.CylinderGeometry(0.045, 0.045, 2.6, 8), std(0x30353b, { metalness: 0.7 }), -side * 1.2, 7.7, 0);
        arm.rotation.z = Math.PI / 2 + side * 0.08; g.add(arm);
        const head = mesh(new T.BoxGeometry(0.9, 0.12, 0.34), std(0x23272c, { metalness: 0.6 }), -side * 2.5, 7.62, 0);
        g.add(head);
        const lamp = mesh(new T.BoxGeometry(0.78, 0.05, 0.26), headMat, -side * 2.5, 7.54, 0, false);
        g.add(lamp);
        return g;
    }

    window.Models = {
        rng: rng, canvasTex: canvasTex, radialTex: radialTex, std: std, mesh: mesh,
        buildCar: buildCar, roundSign: roundSign, stopSign: stopSign, trafficCone: trafficCone,
        trafficLight: trafficLight, pedestrian: pedestrian, zebra: zebra,
        building: building, tree: tree, streetLamp: streetLamp, signTexture: signTexture
    };
})();
