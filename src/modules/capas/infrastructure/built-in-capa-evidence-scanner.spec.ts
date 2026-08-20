import { validateEvidence } from './built-in-capa-evidence-scanner.js';

describe('validateEvidence', () => {
  it('accepts camera JPEG images', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

    expect(() =>
      validateEvidence(jpeg, 'image/jpeg', 'camera.jpg', 1024),
    ).not.toThrow();
  });

  it('accepts WebP images with a valid RIFF signature', () => {
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.from([4, 0, 0, 0]),
      Buffer.from('WEBP'),
      Buffer.from('VP8 '),
    ]);

    expect(() =>
      validateEvidence(webp, 'image/webp', 'camera.webp', 1024),
    ).not.toThrow();
  });

  it.each([
    ['image/heic', 'heic'],
    ['image/heif', 'mif1'],
  ])(
    'accepts %s images with a supported ISO base media brand',
    (type, brand) => {
      const image = Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from('ftyp'),
        Buffer.from(brand),
        Buffer.from([0, 0, 0, 0]),
      ]);

      expect(() =>
        validateEvidence(image, type, `camera.${brand}`, 1024),
      ).not.toThrow();
    },
  );

  it('rejects a mismatched image declaration', () => {
    expect(() =>
      validateEvidence(
        Buffer.from('not an image'),
        'image/jpeg',
        'fake.jpg',
        1024,
      ),
    ).toThrow('declared evidence type');
  });
});
