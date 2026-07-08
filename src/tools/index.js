import Clutter from 'gi://Clutter';
import { N_ } from '../i18n.js';

import { DrawingTool } from './DrawingTool.js';
import { FreehandTool } from './FreehandTool.js';
import { RectangleTool } from './RectangleTool.js';
import { SolidRectangleTool } from './SolidRectangleTool.js';
import { HighlighterTool } from './HighlighterTool.js';
import { ArrowTool } from './ArrowTool.js';
import { TextTool } from './TextTool.js';
import { StampTool } from './StampTool.js';
import { BlurTool } from './BlurTool.js';

export { DrawingTool };
export { FreehandTool, RectangleTool, SolidRectangleTool, HighlighterTool, ArrowTool, TextTool, StampTool, BlurTool };

export const TOOLS = [
    { id: 'select', name: N_('Crop'), icon: 'icons/selection-opaque-3-symbolic.svg', keybindings: [Clutter.KEY_1, Clutter.KEY_ampersand, Clutter.KEY_q], isDrawing: false },
    { id: 'drag', name: N_('Drag'), icon: 'icons/pointer-primary-click-symbolic.svg', keybindings: [Clutter.KEY_2, Clutter.KEY_eacute, Clutter.KEY_d], isDrawing: false, isDrag: true },
    new FreehandTool(),
    new RectangleTool(),
    new SolidRectangleTool(),
    new HighlighterTool(),
    new ArrowTool(),
    new TextTool(),
    new StampTool(),
    new BlurTool(),
];

export const TOOL_SHORTCUTS = Object.fromEntries(TOOLS.flatMap((t) => t.keybindings.map((key) => [key, t.id])));

export function getToolDef(id) {
    return TOOLS.find((t) => t.id === id) ?? null;
}
