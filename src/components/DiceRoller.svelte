<script lang="ts">
/**
 * DiceRoller Component
 * 
 * Displays an animated 3D dice roll with physics-based animation
 * - Shows a d6 (6-sided die) with realistic rolling animation
 * - Automatically rolls when shown
 * - Calls onRollComplete with the result
 */

import { onMount } from 'svelte';

interface Props {
  onRollComplete: (result: number) => void;
  difficulty?: number; // Optional: show difficulty indicator
}

let { onRollComplete, difficulty }: Props = $props();

let diceValue = $state(1);
let isRolling = $state(false);
let showResult = $state(false);
let hasRolled = $state(false);
let rotation = $state({ x: 0, y: 0, z: 0 });

// Dice face positions (rotation angles to show each face)
const diceFaces = {
  1: { x: 0, y: 0, z: 0 },
  2: { x: 0, y: -90, z: 0 },
  3: { x: 0, y: 0, z: 90 },
  4: { x: 0, y: 0, z: -90 },
  5: { x: 0, y: 90, z: 0 },
  6: { x: 180, y: 0, z: 0 },
};

/**
 * Roll the dice with animation
 */
function rollDice() {
  if (hasRolled) return; // Prevent multiple rolls
  
  hasRolled = true;
  isRolling = true;
  showResult = false;
  
  // Generate random result (1-6)
  const result = Math.floor(Math.random() * 6) + 1;
  
  // Animate the roll with multiple spins
  const spins = 3 + Math.random() * 2; // 3-5 full rotations
  const duration = 2000; // 2 seconds
  const startTime = Date.now();
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Easing function (ease-out cubic)
    const eased = 1 - Math.pow(1 - progress, 3);
    
    if (progress < 1) {
      // Spinning animation
      rotation = {
        x: eased * spins * 360 + Math.sin(progress * Math.PI * 8) * 30,
        y: eased * spins * 360 + Math.cos(progress * Math.PI * 6) * 30,
        z: eased * spins * 360 + Math.sin(progress * Math.PI * 10) * 30,
      };
      requestAnimationFrame(animate);
    } else {
      // Land on final result
      diceValue = result;
      rotation = diceFaces[result as keyof typeof diceFaces];
      isRolling = false;
      
      // Show result after a brief delay
      setTimeout(() => {
        showResult = true;
        
        // Call completion callback after showing result
        setTimeout(() => {
          onRollComplete(result);
        }, 1500);
      }, 300);
    }
  };
  
  requestAnimationFrame(animate);
}

// Don't auto-roll - wait for user interaction
</script>

<div
  class="dice-container"
  role="button"
  tabindex={!hasRolled ? 0 : -1}
  onclick={!hasRolled ? rollDice : undefined}
  onkeydown={(e) => {
    if (!hasRolled && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      rollDice();
    }
  }}
  aria-label={!hasRolled ? 'Roll the dice' : 'Dice rolled'}
>
  <div class="dice-scene">
    <!-- Difficulty indicator -->
    {#if difficulty}
      <div class="difficulty-badge">
        <span class="difficulty-label">Target:</span>
        <span class="difficulty-value">{difficulty}+</span>
      </div>
    {/if}
    
    <!-- 3D Dice -->
    <div 
      class="dice"
      class:rolling={isRolling}
      style="transform: rotateX({rotation.x}deg) rotateY({rotation.y}deg) rotateZ({rotation.z}deg)"
    >
      <!-- Face 1 (front) -->
      <div class="face face-1">
        <div class="dot"></div>
      </div>
      
      <!-- Face 2 (right) -->
      <div class="face face-2">
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      
      <!-- Face 3 (top) -->
      <div class="face face-3">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      
      <!-- Face 4 (bottom) -->
      <div class="face face-4">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      
      <!-- Face 5 (left) -->
      <div class="face face-5">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
      
      <!-- Face 6 (back) -->
      <div class="face face-6">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
  
  <!-- Result display -->
  {#if showResult}
    <div class="result-display">
      <div class="result-value">{diceValue}</div>
      {#if difficulty}
        <div class="result-text">
          {diceValue >= difficulty ? '✓ Success!' : '✗ Not quite...'}
        </div>
      {/if}
    </div>
  {/if}
  
  <!-- Instructions or Rolling text -->
  {#if !hasRolled}
    <div class="instruction-text">
      <div class="tap-icon">👆</div>
      <div>Tap anywhere to roll!</div>
    </div>
  {:else if isRolling}
    <div class="rolling-text">Rolling...</div>
  {/if}
</div>

<style>
  .dice-container {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    animation: fadeIn 0.3s ease-out;
  }
  
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  
  .dice-scene {
    perspective: 1000px;
    position: relative;
  }
  
  .difficulty-badge {
    position: absolute;
    top: -80px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    font-size: 20px;
    font-weight: bold;
    box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
    display: flex;
    gap: 8px;
    align-items: center;
  }
  
  .difficulty-label {
    opacity: 0.9;
    font-size: 16px;
  }
  
  .difficulty-value {
    font-size: 28px;
  }
  
  .dice {
    width: 120px;
    height: 120px;
    position: relative;
    transform-style: preserve-3d;
  }
  
  .face {
    position: absolute;
    width: 120px;
    height: 120px;
    background: linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%);
    border: 3px solid #333;
    border-radius: 12px;
    display: grid;
    padding: 12px;
    box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  
  /* Face positioning */
  .face-1 {
    transform: rotateY(0deg) translateZ(60px);
    grid-template: 1fr / 1fr;
    place-items: center;
  }
  
  .face-2 {
    transform: rotateY(90deg) translateZ(60px);
    grid-template: 1fr 1fr / 1fr;
    place-items: center;
  }
  
  .face-3 {
    transform: rotateX(90deg) translateZ(60px);
    grid-template: 1fr 1fr 1fr / 1fr;
    place-items: center;
  }
  
  .face-4 {
    transform: rotateX(-90deg) translateZ(60px);
    grid-template: 1fr 1fr / 1fr 1fr;
    place-items: center;
  }
  
  .face-5 {
    transform: rotateY(-90deg) translateZ(60px);
    grid-template: 1fr 1fr 1fr / 1fr 1fr;
    place-items: center;
  }
  
  .face-5 .dot:nth-child(1) { grid-area: 1 / 1; }
  .face-5 .dot:nth-child(2) { grid-area: 1 / 2; }
  .face-5 .dot:nth-child(3) { grid-area: 2 / 1 / 2 / 3; }
  .face-5 .dot:nth-child(4) { grid-area: 3 / 1; }
  .face-5 .dot:nth-child(5) { grid-area: 3 / 2; }
  
  .face-6 {
    transform: rotateY(180deg) translateZ(60px);
    grid-template: 1fr 1fr 1fr / 1fr 1fr;
    place-items: center;
  }
  
  .dot {
    width: 18px;
    height: 18px;
    background: #333;
    border-radius: 50%;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  
  .result-display {
    margin-top: 60px;
    text-align: center;
    animation: slideUp 0.5s ease-out;
  }
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .result-value {
    font-size: 72px;
    font-weight: bold;
    color: white;
    text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    margin-bottom: 12px;
  }
  
  .result-text {
    font-size: 32px;
    font-weight: bold;
    padding: 12px 24px;
    border-radius: 12px;
    display: inline-block;
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
  }
  
  .instruction-text {
    margin-top: 40px;
    text-align: center;
    color: white;
    font-weight: bold;
    animation: bounce-gentle 2s ease-in-out infinite;
  }
  
  .tap-icon {
    font-size: 48px;
    margin-bottom: 12px;
    animation: tap-pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes tap-pulse {
    0%, 100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.2);
    }
  }
  
  @keyframes bounce-gentle {
    0%, 100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-10px);
    }
  }
  
  .instruction-text div:last-child {
    font-size: 24px;
  }
  
  .rolling-text {
    margin-top: 40px;
    font-size: 24px;
    color: white;
    font-weight: bold;
    animation: pulse 1s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
</style>