/**
 * utils/logger.js
 * Winston-based structured logger with daily file rotation.
 */

'use strict';

const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const chalk = require('chalk');
const path  = require('path');

const { combine, timestamp, printf, errors } = format;

// ── Console Format ────────────────────────────────────────────────────────────
const levelColors = {
  error: chalk.red.bold,
  warn:  chalk.yellow.bold,
  info:  chalk.cyan,
  debug: chalk.gray,
};

const consoleFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const color  = levelColors[level] || chalk.white;
  const prefix = color(`[${level.toUpperCase().padEnd(5)}]`);
  const time   = chalk.dim(ts);
  return `${time} ${prefix} ${stack || message}`;
});

// ── File Format ───────────────────────────────────────────────────────────────
const fileFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return JSON.stringify({ ts, level, message: stack || message });
});

// ── Logger Instance ───────────────────────────────────────────────────────────
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Console
    new transports.Console({ format: combine(timestamp({ format: 'HH:mm:ss' }), consoleFormat) }),

    // Daily rotating info log
    new DailyRotateFile({
      filename:    path.join('logs', 'bot-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize:     '20m',
      maxFiles:    '14d',
      level:       'info',
      format:      combine(timestamp(), fileFormat),
    }),

    // Separate error log
    new DailyRotateFile({
      filename:    path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize:     '20m',
      maxFiles:    '30d',
      level:       'error',
      format:      combine(timestamp(), fileFormat),
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
