// C21 (Communications and Messaging Review Two): the member's signature mock keeps an image as the
// API's cleaner does: the firm's own (an uploaded email image or its logo) stays, any other image
// is dropped, and a signature with nothing left to show is 400 SIGNATURE_EMPTY. The screen cannot
// put a foreign image in the editor, so this runs the mock directly.
import { describe, expect, it } from 'vitest';
import { createLeadPipelineMock } from '../mocks/leads-pipeline';

const uploaded = async (mock: ReturnType<typeof createLeadPipelineMock>) => {
  const ticket = await mock.createEmailImageUpload({
    contentType: 'image/png',
    sizeBytes: 68,
    sha256: 'a'.repeat(64),
  });
  return (await mock.confirmEmailImageUpload({ uploadToken: ticket.uploadToken })).url;
};

describe('lead pipeline mock: the signature keeps only the firm’s images (C21)', () => {
  it('keeps an uploaded image and the firm logo', async () => {
    const mock = createLeadPipelineMock();
    const image = await uploaded(mock);
    const logo = (await mock.signature()).logoUrl ?? '';
    const saved = await mock.saveSignature({
      html: `<p>Kind regards<img src="${image}" alt="" style="width: 120px;"></p><p><img src="${logo}" alt=""></p>`,
    });
    expect(saved.html).toContain(`src="${image}"`);
    expect(saved.html).toContain(`src="${logo}"`);
    // An image alone is something to show.
    const alone = await mock.saveSignature({ html: `<p><img src="${image}" alt=""></p>` });
    expect(alone.html).toContain(`src="${image}"`);
  });

  it('drops any other image, and refuses a signature left with nothing', async () => {
    const mock = createLeadPipelineMock();
    const saved = await mock.saveSignature({
      html: '<p>Kind regards<img src="https://elsewhere.example.test/a.png" alt=""></p>',
    });
    expect(saved.html).toBe('<p>Kind regards</p>');
    await expect(
      mock.saveSignature({ html: '<p><img src="https://elsewhere.example.test/a.png"></p>' }),
    ).rejects.toMatchObject({ status: 400, code: 'SIGNATURE_EMPTY' });
  });
});
