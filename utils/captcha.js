/**
 * utils/captcha.js
 * Generates math-based CAPTCHA challenges and optionally image-based ones
 * using the `canvas` package.
 */

'use strict';

const { AttachmentBuilder } = require('discord.js');
let   canvas;
try { canvas = require('canvas'); } catch { /* canvas optional */ }

// ── Math CAPTCHA ──────────────────────────────────────────────────────────────

/**
 * Generate a simple arithmetic CAPTCHA.
 * @returns {{ question: string, answer: string, attachment: null }}
 */
function mathCaptcha() {
  const ops = ['+', '-', '×'];
  const op  = ops[Math.floor(Math.random() * ops.length)];
  let a, b, answer;

  switch (op) {
    case '+':
      a = rand(10, 50); b = rand(1, 30);
      answer = String(a + b);
      break;
    case '-':
      a = rand(20, 80); b = rand(1, a);
      answer = String(a - b);
      break;
    case '×':
      a = rand(2, 12);  b = rand(2, 10);
      answer = String(a * b);
      break;
  }

  return { question: `${a} ${op} ${b} = ?`, answer, attachment: null };
}

/**
 * Generate an image-based CAPTCHA using canvas (if available).
 * Falls back to math CAPTCHA if canvas is not installed.
 * @returns {{ question: string, answer: string, attachment: AttachmentBuilder|null }}
 */
async function imageCaptcha() {
  if (!canvas) return mathCaptcha();

  const { createCanvas } = canvas;
  const c   = createCanvas(300, 100);
  const ctx = c.getContext('2d');

  // Background
  ctx.fillStyle = '#23272a';
  ctx.fillRect(0, 0, 300, 100);

  // Noise lines
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = randomColor(0.3);
    ctx.lineWidth   = rand(1, 3);
    ctx.beginPath();
    ctx.moveTo(rand(0, 300), rand(0, 100));
    ctx.lineTo(rand(0, 300), rand(0, 100));
    ctx.stroke();
  }

  // Generate 6 random alphanumeric chars
  const chars  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const answer = Array.from({ length: 6 }, () => chars[rand(0, chars.length - 1)]).join('');

  // Draw each character with slight rotation
  ctx.font = 'bold 36px Arial';
  for (let i = 0; i < answer.length; i++) {
    ctx.save();
    ctx.fillStyle = randomColor(1);
    ctx.translate(30 + i * 42, 65);
    ctx.rotate((Math.random() - 0.5) * 0.5);
    ctx.fillText(answer[i], 0, 0);
    ctx.restore();
  }

  // Noise dots
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = randomColor(0.5);
    ctx.beginPath();
    ctx.arc(rand(0, 300), rand(0, 100), rand(1, 3), 0, Math.PI * 2);
    ctx.fill();
  }

  const buffer     = c.toBuffer('image/png');
  const attachment = new AttachmentBuilder(buffer, { name: 'captcha.png' });

  return { question: 'Enter the text shown in the image above:', answer, attachment };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomColor(alpha = 1) {
  return `rgba(${rand(100, 255)},${rand(100, 255)},${rand(100, 255)},${alpha})`;
}

module.exports = { mathCaptcha, imageCaptcha };
