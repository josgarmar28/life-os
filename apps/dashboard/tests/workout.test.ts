import { describe, expect, it } from 'vitest';
import { kgStep, machineOptions } from '@shared/progression.ts';

describe('máquinas a elegir con un toque', () => {
  it('principal y plan B o alternativa entre paréntesis', () => {
    expect(machineOptions('New Tech Wide (plan B: Prime P-102)')).toEqual(['New Tech Wide', 'Prime P-102']);
    expect(machineOptions('Panatta Super French Press (o polea alta de espaldas)')).toEqual(['Panatta Super French Press', 'polea alta de espaldas']);
  });
  it('alternativas tras "alt.:" separadas por comas', () => {
    expect(machineOptions('Press de pecho en máquina sentado · alt.: mancuernas en banco plano, multipower en banco plano'))
      .toEqual(['Press de pecho en máquina sentado', 'mancuernas en banco plano', 'multipower en banco plano']);
  });
  it('un paréntesis que no es alternativa y las comas del nombre se quedan', () => {
    expect(machineOptions('New Tech (cruce de poleas si no hay tope)')).toEqual(['New Tech (cruce de poleas si no hay tope)']);
    expect(machineOptions('Hack Arsenal (hombreras), rango largo')).toEqual(['Hack Arsenal (hombreras), rango largo']);
    expect(machineOptions('Prime P-127, perfil 1')).toEqual(['Prime P-127, perfil 1']);
    expect(machineOptions(undefined)).toEqual([]);
  });
});

describe('paso de kg de los botones − / +', () => {
  it('sigue el escalón de su tipo de carga', () => {
    expect(kgStep('discos', 70)).toBe(2.5);
    expect(kgStep('discos', 15)).toBe(0.5);
    expect(kgStep('barra', 30)).toBe(2);
    expect(kgStep('hibrida', 40)).toBe(2.27);
    expect(kgStep('mancuerna', 20)).toBe(2);
    expect(kgStep('selector', 40)).toBe(2.5);
    expect(kgStep(undefined, 50)).toBe(1.5);
  });
});
