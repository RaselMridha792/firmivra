import { ApiRequestError } from '@firmivra/types';

// Shared by the Firm Sign mocks (mocks/esign.ts and mocks/esign-signing.ts), R13. Nothing runs on
// import but constants.

/** NEXT_PUBLIC_API_MOCK_ESIGN=off shows Firm Sign turned off (menus hide it; calls answer 403). */
export const ESIGN_OFF = process.env.NEXT_PUBLIC_API_MOCK_ESIGN === 'off';
const esignRole = process.env.NEXT_PUBLIC_API_MOCK_ESIGN_ROLE;
/** NEXT_PUBLIC_API_MOCK_ESIGN_ROLE=MANAGER or VIEWER: Sam Staff with that Firm Sign role. */
export const MOCK_ESIGN_ROLE =
  esignRole === 'MANAGER' || esignRole === 'VIEWER' ? esignRole : undefined;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const LETTER = { width: 612, height: 792 };
export const iso = (ms: number) => new Date(ms).toISOString();
export const copy = <T>(value: T): T => structuredClone(value);
export const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

/** A generated 2-page sample PDF (Helvetica text, synthetic), base64. */
const SAMPLE_PDF_BASE64 =
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoK' +
  'PDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUiA0IDAgUl0gL0NvdW50IDIgPj4KZW5kb2JqCjMgMCBvYmoKPDwg' +
  'L1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9G' +
  'b250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNiAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUg' +
  'L1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8' +
  'IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNyAwIFIgPj4KZW5kb2JqCjUgMCBvYmoKPDwgL1R5cGUgL0ZvbnQg' +
  'L1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago2IDAgb2JqCjw8IC9MZW5ndGgg' +
  'Mjc1ID4+CnN0cmVhbQpCVCAvRjEgMTIgVGYgNzIgNzIwIFRkIDE2IFRMCihTYW1wbGUgRW5nYWdlbWVudCBMZXR0' +
  'ZXIgKHN5bnRoZXRpYyB0ZXN0IGRvY3VtZW50KSkgVGogVCoKKCkgVGogVCoKKFRoaXMgcGFnZSBzdGFuZHMgaW4g' +
  'Zm9yIGEgcmVhbCBkb2N1bWVudCBpbiBtb2NrIG1vZGUuKSBUaiBUKgooRmlybTogTFZQIEFjY291bnRpbmcgJiBU' +
  'YXhlcyAobW9jaykpIFRqIFQqCihDbGllbnQ6IEphbWllIFNhbXBsZSAoc3ludGhldGljKSkgVGogVCoKKCkgVGog' +
  'VCoKKFBhZ2UgMSBvZiAyKSBUaiBUKgpFVAplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwgL0xlbmd0aCAxNjYg' +
  'Pj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MjAgVGQgMTYgVEwKKFNpZ25hdHVyZXMpIFRqIFQqCigpIFRqIFQq' +
  'CihDbGllbnQgc2lnbmF0dXJlOiBfX19fX19fX19fX19fX19fX19fX19fKSBUaiBUKgooRGF0ZTogX19fX19fX19f' +
  'X19fX18pIFRqIFQqCigpIFRqIFQqCihQYWdlIDIgb2YgMikgVGogVCoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVm' +
  'CjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAow' +
  'MDAwMDAwMTIxIDAwMDAwIG4gCjAwMDAwMDAyNDcgMDAwMDAgbiAKMDAwMDAwMDM3MyAwMDAwMCBuIAowMDAwMDAw' +
  'NDQzIDAwMDAwIG4gCjAwMDAwMDA3NjkgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA4IC9Sb290IDEgMCBSID4+' +
  'CnN0YXJ0eHJlZgo5ODYKJSVFT0YK';
/** A tiny grey PNG, for image files. */
export const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** The sample PDF as a data: URL, for the page viewer and the downloads. */
export const SAMPLE_PDF_URL = `data:application/pdf;base64,${SAMPLE_PDF_BASE64}`;
