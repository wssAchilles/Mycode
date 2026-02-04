# ML Platform Design System (Academic Tech Dark)

## Purpose
This document defines the visual and interaction rules for the ML Platform UI. It is the single source of truth for layout, typography, color, and component behavior.

## Foundations

### Color
- Background: `#0F172A`
- Surface: `#1E293B`
- Surface Highlight: `#334155`
- Primary (Cyan): `#00F5FF`
- Secondary (Purple): `#7B61FF`
- Accent (Green): `#00FF94`
- Error: `#FF4D4D`
- Warning: `#FFC107`
- Info: `#2196F3`
- Text Primary: `#F8FAFC`
- Text Secondary: `#94A3B8`

### Typography
- Display/Headings: `Space Grotesk`
- Body: `DM Sans`
- Code/Numbers: `Fira Code`
- Body line-height: `1.5`

### Spacing
- XS `4`
- SM `8`
- MD `16`
- LG `24`
- XL `32`
- XXL `48`

### Radius
- SM `8`
- MD `12`
- LG `16`
- XL `24`

### Shadows
- Soft: `blur 12 / y 6 / 20% black`

## Layout & Responsiveness
- Max content width: `1200px`
- Breakpoints:
  - Mobile: `< 600`
  - Tablet: `600 - 1099`
  - Desktop: `>= 1100`
- Use `ResponsiveLayout` and `ResponsiveContainer` to keep readable line length.
- Avoid fixed sidebars on small screens; stack panels vertically.

## Components

### Buttons
- Primary: Cyan background, dark text.
- Secondary: Outlined with subtle border.
- Icon-only buttons: Always provide tooltip/semantic label.
- Minimum touch target: `44x44`.

### Cards
- Prefer `GlassCard` for feature modules, dashboards, and analytics.
- Use subtle borders (`glassBorder`) and gentle gradients.

### Inputs
- Always include `labelText`.
- Use autofill hints for auth forms.

### Charts & Data
- Use consistent color mapping per module.
- Provide axis labels and tooltips.
- Prefer dark-friendly chart palettes.

## Motion
- Micro-interactions: `150-300ms`.
- Use opacity/transform transitions, avoid layout reflow.
- Respect reduced motion for accessibility.

## Accessibility
- Minimum contrast ratio: `4.5:1` for body text.
- Icon-only controls require tooltip/semantic label.
- Provide labels for inputs and error text near field.

## Anti-Patterns
- Mixed light/dark card backgrounds within the same view.
- Grey-on-grey text for primary content.
- Fixed-width layouts that cause horizontal scroll on small screens.
