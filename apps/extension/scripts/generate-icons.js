const fs = require('fs');
const path = require('path');

// Simple SVG icon
const svg = `
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#grad)"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" 
        font-size="64" fill="white">💎</text>
</svg>
`;

const publicDir = path.join(__dirname, '../public');

// Save as SVG
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svg);

console.log('Icon generated! Convert to PNG using an online tool or ImageMagick');
console.log('Commands:');
console.log('  convert icon.svg -resize 16x16 icon16.png');
console.log('  convert icon.svg -resize 48x48 icon48.png');
console.log('  convert icon.svg -resize 128x128 icon128.png');