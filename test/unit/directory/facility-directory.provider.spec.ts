import { parseFacilityCsv } from '../../../src/modules/directory/providers/facility-directory.provider';

describe('parseFacilityCsv', () => {
  const header =
    'sourceId,name,address,county,town,phone,email,website,lat,lng,licence';

  it('parses a standard row', () => {
    const rows = parseFacilityCsv(
      `${header}\nFA001,St Matthews,1 Main St,Nairobi,Nairobi CBD,+254700000000,a@b.c,https://x.example,-1.29,36.82,L001\n`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId: 'FA001',
      name: 'St Matthews',
      address: '1 Main St',
      county: 'Nairobi',
      town: 'Nairobi CBD',
      phone: '+254700000000',
      email: 'a@b.c',
      website: 'https://x.example',
      locationLat: -1.29,
      locationLng: 36.82,
      licence: 'L001',
    });
  });

  it('handles quoted fields with commas and escaped quotes', () => {
    const rows = parseFacilityCsv(
      `${header}\nFA002,"Grace, & Co. Hospital","Unit ""2"", Rev","Kiambu"},\n`.replace('},\n', '\n'),
    );
    expect(rows[0]?.name).toBe('Grace, & Co. Hospital');
    expect(rows[0]?.address).toBe('Unit "2", Rev');
    expect(rows[0]?.county).toBe('Kiambu');
  });

  it('skips empty lines and malformed rows missing id/name', () => {
    const rows = parseFacilityCsv(
      `${header}\n\nFA003,NoCoords\n,Untitled\n`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceId).toBe('FA003');
  });

  it('returns [] for a header-only or empty body', () => {
    expect(parseFacilityCsv(header)).toHaveLength(0);
    expect(parseFacilityCsv('')).toHaveLength(0);
  });

  it('tolerates CRLF line endings', () => {
    const rows = parseFacilityCsv(
      `${header}\r\nFA009,CRLF Clinic,,,,\r\nFA010,Second,,,,\r\n`,
    );
    expect(rows.map((r) => r.sourceId)).toEqual(['FA009', 'FA010']);
  });
});