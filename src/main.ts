/**
 * BoxMaker Pro — Application Entry Point
 * Phase 1: Project Setup & Architecture Design
 * Author: Ferhat Göksel
 * Date: 2026-03-01
 */

// Phase 1 — verify core types load correctly
import type { BoxParams, BoxGeometry, SheetLayout } from './models/types';

// Application version
const APP_VERSION = '1.0.0';
const APP_AUTHOR  = 'Ferhat Göksel';

console.log(`BoxMaker Pro v${APP_VERSION} — ${APP_AUTHOR}`);
console.log('Phase 1: Project Setup & Architecture Design complete.');
console.log('Core TypeScript interfaces loaded successfully.');

// Export for future phases
export type { BoxParams, BoxGeometry, SheetLayout };