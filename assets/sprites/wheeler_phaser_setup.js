// Phaser 3 loader + animation creation for Wheeler (ring-fire caster)
// Assumes:
//   assets/sprites/wheeler.png (32x32 frames, 6x4 grid = 24 frames)
//   assets/sprites/wheeler.animmap.json (the JSON created here)

// --- Preload ---
this.load.spritesheet('wheeler', 'assets/sprites/wheeler.png', {
  frameWidth: 32,
  frameHeight: 32
});
this.load.json('wheeler_animmap', 'assets/sprites/wheeler.animmap.json');

// --- Create ---
const map = this.cache.json.get('wheeler_animmap');
const make = (key) => {
  const cfg = map.animations[key];
  this.anims.create({
    key,
    frames: cfg.frames.map(i => ({ key: 'wheeler', frame: i })),
    frameRate: cfg.frameRate,
    repeat: cfg.repeat
  });
};

make('wheeler_idle');
make('wheeler_move');
make('wheeler_attack');
make('wheeler_hit');
make('wheeler_death');

// Example usage:
// const sprite = this.add.sprite(x, y, 'wheeler', 0);
// sprite.play('wheeler_idle');
