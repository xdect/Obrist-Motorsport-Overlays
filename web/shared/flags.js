// Flaggen aus iRacings SessionFlags (Bitfeld) – gemeinsam für Core (Node), Flaggen und Digiflag.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OMFlags = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const B = {
    checkered: 0x1, white: 0x2, green: 0x4, yellow: 0x8, red: 0x10, blue: 0x20, debris: 0x40, crossed: 0x80,
    yellowWaving: 0x100, oneLapToGreen: 0x200, greenHeld: 0x400, tenToGo: 0x800, fiveToGo: 0x1000,
    randomWaving: 0x2000, caution: 0x4000, cautionWaving: 0x8000,
    black: 0x10000, disqualify: 0x20000, servicible: 0x40000, furled: 0x80000, repair: 0x100000,
  };
  // Reihenfolge = Wichtigkeit. led: Farbe der Digiflag, text: Anzeige der Digiflag
  const FLAGS = [
    { id: 'disqualify', bits: B.disqualify, name: 'Schwarze Flagge', title: 'Disqualifiziert', color: '#16171A', led: '#F2F0EA', text: 'DQ' },
    { id: 'black', bits: B.black, name: 'Schwarze Flagge', title: 'Strafe – in die Box', color: '#16171A', led: '#F2F0EA', text: 'BOX' },
    { id: 'red', bits: B.red, name: 'Rote Flagge', title: 'Session unterbrochen', color: '#D7263D', led: '#FF2A2A', text: 'STOP' },
    { id: 'repair', bits: B.repair, name: 'Reparaturflagge', title: 'Schaden – in die Box', color: '#FF7A00', led: '#FF7A00', text: 'REP' },
    { id: 'checkered', bits: B.checkered, name: 'Zielflagge', title: 'Rennende', color: '#F2F0EA', led: '#F2F0EA', text: 'checker' },
    { id: 'caution', bits: B.caution | B.cautionWaving, name: 'Safety Car', title: 'Gelbphase – Safety Car', color: '#F5C400', led: '#F5C400', text: 'SC' },
    { id: 'yellow', bits: B.yellow | B.yellowWaving | B.randomWaving, name: 'Gelbe Flagge', title: 'Gefahr voraus', color: '#F5C400', led: '#F5C400', text: '!' },
    { id: 'debris', bits: B.debris, name: 'Gelb-rote Flagge', title: 'Rutschige Strecke', color: '#F5C400', led: '#F5C400', text: 'OIL' },
    { id: 'blue', bits: B.blue, name: 'Blaue Flagge', title: 'Schnelleres Auto naht', color: '#2E6BFF', led: '#3D7BFF', text: 'arrow' },
    { id: 'white', bits: B.white, name: 'Weisse Flagge', title: 'Letzte Runde', color: '#F2F0EA', led: '#F2F0EA', text: '1L' },
    { id: 'green', bits: B.green, name: 'Grüne Flagge', title: 'Strecke frei', color: '#2BB34A', led: '#2BD552', text: 'GO' },
  ];
  function decode(bits) {
    const b = Number(bits) >>> 0;
    for (const f of FLAGS) if (b & f.bits) return f;
    return null;
  }
  return { B, FLAGS, decode };
});
