/* ==========================================================================
 *  pipeline.js — مصفوفة المعالجة الأولية (CLAHE → HSV Red Mask → Isolation)
 *  • إن كان خادم FastAPI/OpenCV يعمل  → تُستدعى نفس المراحل من بايثون (OpenCV الحقيقي).
 *  • إن لم يكن يعمل → تُنفَّذ نفس الخوارزمية محلياً بالجافاسكربت (Fallback حقيقي، وليس رسماً ثابتاً).
 * ========================================================================== */
(function (root) {
    'use strict';

    /* ---- CLAHE على قناة V (مكافئ cv2.createCLAHE(clipLimit, tileGridSize)) ---- */
    function clahe(V, w, h, gx, gy, clipLimit) {
        const tw = Math.ceil(w / gx), th = Math.ceil(h / gy);
        const luts = new Array(gx * gy);
        for (let ty = 0; ty < gy; ty++) for (let tx = 0; tx < gx; tx++) {
            const hist = new Float64Array(256);
            const x0 = tx * tw, x1 = Math.min(w, x0 + tw), y0 = ty * th, y1 = Math.min(h, y0 + th);
            let n = 0;
            for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { hist[V[y * w + x]]++; n++; }
            const lut = new Uint8Array(256);
            if (n === 0) { for (let i = 0; i < 256; i++) lut[i] = i; luts[ty * gx + tx] = lut; continue; }
            const cl = Math.max(1, Math.floor(clipLimit * n / 256));
            let excess = 0;
            for (let i = 0; i < 256; i++) if (hist[i] > cl) { excess += hist[i] - cl; hist[i] = cl; }
            const add = excess / 256;
            let acc = 0;
            for (let i = 0; i < 256; i++) {
                acc += hist[i] + add;
                lut[i] = Math.max(0, Math.min(255, Math.round(acc * 255 / n)));
            }
            luts[ty * gx + tx] = lut;
        }
        const out = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) {
            const fy = (y + 0.5) / th - 0.5;
            let ty0 = Math.floor(fy), wy = fy - ty0, ty1 = ty0 + 1;
            if (ty0 < 0) { ty0 = 0; wy = 0; } if (ty1 > gy - 1) ty1 = gy - 1; if (ty0 > gy - 1) ty0 = gy - 1;
            for (let x = 0; x < w; x++) {
                const fx = (x + 0.5) / tw - 0.5;
                let tx0 = Math.floor(fx), wx = fx - tx0, tx1 = tx0 + 1;
                if (tx0 < 0) { tx0 = 0; wx = 0; } if (tx1 > gx - 1) tx1 = gx - 1; if (tx0 > gx - 1) tx0 = gx - 1;
                const v = V[y * w + x];
                const a = luts[ty0 * gx + tx0][v], b = luts[ty0 * gx + tx1][v];
                const c = luts[ty1 * gx + tx0][v], d = luts[ty1 * gx + tx1][v];
                out[y * w + x] = Math.round((a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy);
            }
        }
        return out;
    }

    /* ---- RGB → HSV بمقياس OpenCV (H:0-179, S,V:0-255) ---- */
    function rgb2hsv(r, g, b) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        let h = 0;
        if (d > 0) {
            if (mx === r) h = 60 * (((g - b) / d) % 6);
            else if (mx === g) h = 60 * ((b - r) / d + 2);
            else h = 60 * ((r - g) / d + 4);
            if (h < 0) h += 360;
        }
        return [Math.round(h / 2) % 180, mx === 0 ? 0 : Math.round(d / mx * 255), mx];
    }

    /**
     * يشغّل المرحلتين على ImageData ويُعيد أربع مصفوفات جاهزة للعرض
     * @param {Uint8ClampedArray} rgba  w*h*4
     */
    function run(rgba, w, h, opts) {
        opts = opts || {};
        const gx = opts.gx || 8, gy = opts.gy || 8, clip = opts.clip || 3.0;
        const n = w * h, V = new Uint8Array(n);
        for (let i = 0; i < n; i++) V[i] = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
        const V2 = clahe(V, w, h, gx, gy, clip);

        const enhanced = new Uint8ClampedArray(n * 4);
        const mask = new Uint8ClampedArray(n * 4);
        const isolated = new Uint8ClampedArray(n * 4);
        let count = 0, minX = w, minY = h, maxX = -1, maxY = -1;
        for (let i = 0; i < n; i++) {
            const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
            const v = V[i], k = v > 0 ? V2[i] / v : 1;
            const R = Math.min(255, r * k), G = Math.min(255, g * k), B = Math.min(255, b * k);
            enhanced[i * 4] = R; enhanced[i * 4 + 1] = G; enhanced[i * 4 + 2] = B; enhanced[i * 4 + 3] = 255;
            const hsv = rgb2hsv(R, G, B);
            const red = (hsv[0] <= 10 || hsv[0] >= 170) && hsv[1] >= 100 && hsv[2] >= 100;
            const m = red ? 255 : 0;
            mask[i * 4] = mask[i * 4 + 1] = mask[i * 4 + 2] = m; mask[i * 4 + 3] = 255;
            isolated[i * 4] = red ? R : 0; isolated[i * 4 + 1] = red ? G : 0; isolated[i * 4 + 2] = red ? B : 0; isolated[i * 4 + 3] = 255;
            if (red) {
                count++;
                const x = i % w, y = (i / w) | 0;
                if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
        const bbox = count > 30 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null;
        return { enhanced: enhanced, mask: mask, isolated: isolated, maskPixels: count, bbox: bbox };
    }

    /* ---- رسم إطار ليلي مُصطنع يحوي الشاخصة المسقطة ---- */
    function drawFrame(ctx, w, h, type) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#0b0f1a'); g.addColorStop(1, '#171a20');
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        // مباني بعيدة بنوافذ مضيئة
        for (let i = 0; i < 9; i++) {
            const bw = 26 + (i * 17) % 22, bh = 40 + (i * 29) % 50, bx = i * 36 - 6;
            ctx.fillStyle = '#10141c'; ctx.fillRect(bx, h * 0.55 - bh, bw, bh);
            ctx.fillStyle = 'rgba(255,205,120,0.55)';
            for (let k = 0; k < 7; k++) ctx.fillRect(bx + 4 + (k % 3) * 8, h * 0.55 - bh + 6 + Math.floor(k / 3) * 12, 4, 6);
        }
        // الطريق
        ctx.fillStyle = '#16191e';
        ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, h); ctx.lineTo(w * 0.62, h * 0.55); ctx.lineTo(w * 0.38, h * 0.55); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(220,220,200,0.35)'; ctx.setLineDash([10, 12]); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, h * 0.55); ctx.stroke(); ctx.setLineDash([]);

        const cx = w / 2, cy = h * 0.46;
        ctx.save();
        ctx.fillStyle = '#4b5563'; ctx.fillRect(cx - 3, cy, 6, h * 0.5);         // عمود
        if (type === 'stop_sign') {
            ctx.fillStyle = '#9b1c1c'; ctx.beginPath();
            for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(cx + Math.cos(a) * 36, cy - Math.sin(a) * 36); }
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#d9d9d9'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.fillText('STOP', cx, cy + 7);
        } else if (type === 'speed_limit') {
            ctx.fillStyle = '#cfcfcf'; ctx.beginPath(); ctx.arc(cx, cy, 36, 0, 7); ctx.fill();
            ctx.strokeStyle = '#a31515'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(cx, cy, 31, 0, 7); ctx.stroke();
            ctx.fillStyle = '#222'; ctx.font = 'bold 28px Arial'; ctx.textAlign = 'center'; ctx.fillText('30', cx, cy + 10);
        } else if (type === 'pass_right') {
            ctx.fillStyle = '#1d4f9c'; ctx.beginPath(); ctx.arc(cx, cy, 36, 0, 7); ctx.fill();
            ctx.fillStyle = '#d6d6d6'; ctx.beginPath(); ctx.moveTo(cx - 14, cy - 18); ctx.lineTo(cx + 6, cy - 18); ctx.lineTo(cx + 6, cy + 2);
            ctx.lineTo(cx + 18, cy + 2); ctx.lineTo(cx - 4, cy + 24); ctx.lineTo(cx - 26, cy + 2); ctx.lineTo(cx - 14, cy + 2); ctx.closePath(); ctx.fill();
        } else if (type === 'cone') {
            ctx.fillStyle = '#c2570c'; ctx.beginPath(); ctx.moveTo(cx, cy - 34); ctx.lineTo(cx + 22, cy + 34); ctx.lineTo(cx - 22, cy + 34); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#cfcfcf'; ctx.fillRect(cx - 14, cy - 4, 28, 8);
        } else if (type === 'traffic_light') {
            ctx.fillStyle = '#0c0e12'; ctx.fillRect(cx - 14, cy - 40, 28, 78);
            ctx.fillStyle = '#b01515'; ctx.beginPath(); ctx.arc(cx, cy - 24, 9, 0, 7); ctx.fill();
            ctx.fillStyle = '#3a3a20'; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.fill();
            ctx.fillStyle = '#16301f'; ctx.beginPath(); ctx.arc(cx, cy + 24, 9, 0, 7); ctx.fill();
        } else if (type === 'pedestrian') {
            ctx.fillStyle = '#5b3a8c'; ctx.beginPath(); ctx.arc(cx, cy - 26, 9, 0, 7); ctx.fill();
            ctx.fillRect(cx - 9, cy - 16, 18, 34); ctx.fillRect(cx - 9, cy + 18, 7, 28); ctx.fillRect(cx + 2, cy + 18, 7, 28);
        } else if (type === 'zebra') {
            ctx.fillStyle = 'rgba(210,210,200,0.7)';
            for (let i = 0; i < 7; i++) ctx.fillRect(w * 0.18 + i * 28, h * 0.72, 16, 20);
        } else {                                                                  // مركبة أمامية
            ctx.fillStyle = '#242a36'; ctx.fillRect(cx - 40, cy - 6, 80, 40);
            ctx.fillStyle = '#1a1f29'; ctx.fillRect(cx - 28, cy - 24, 56, 20);
            ctx.fillStyle = '#b30f0f'; ctx.fillRect(cx - 36, cy + 8, 16, 8); ctx.fillRect(cx + 20, cy + 8, 16, 8);
        }
        ctx.restore();
        // ضجيج منخفض الإضاءة
        const id = ctx.getImageData(0, 0, w, h), d = id.data;
        for (let i = 0; i < d.length; i += 4) {
            const nz = (Math.random() - 0.5) * 14;
            d[i] = Math.max(0, d[i] * 0.55 + nz); d[i + 1] = Math.max(0, d[i + 1] * 0.55 + nz); d[i + 2] = Math.max(0, d[i + 2] * 0.55 + nz);
        }
        ctx.putImageData(id, 0, 0);
    }

    root.TSRPipeline = { clahe: clahe, rgb2hsv: rgb2hsv, run: run, drawFrame: drawFrame };
    if (typeof module !== 'undefined') module.exports = root.TSRPipeline;
})(typeof window !== 'undefined' ? window : globalThis);
