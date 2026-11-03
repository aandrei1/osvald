import type { Gender } from '@osvald/shared';
import { describe, expect, it } from 'vitest';

import { RuleBasedGenderClassifier } from './gender-classifier.js';

const classifier = new RuleBasedGenderClassifier();

function genderOf(name: string, description: string | null = null): Gender {
  return classifier.classify({ name, description });
}

describe('RuleBasedGenderClassifier', () => {
  it.each<[string, string | null, Gender]>([
    // Avarul: the cast-list note decides
    ['Anselme', 'tatăl lui Valère și al Marianei', 'male'],
    ['Brindavoine', 'servitorul lui Harpagon', 'male'],
    ['Frosine', 'femeie pețitoare', 'female'],
    ['La Flèche', 'valetul lui Cléante', 'male'],
    ['Élise', 'fiica lui Harpagon, iubita lui Valère', 'female'],
    ['Valère', 'fiul lui Anselme si iubitul Élisei', 'male'],
    ['Mariane', 'iubita lui Cléante si cea pe care o iubește', 'female'],
    ['Harpagon', null, 'male'],
    ['Jupânul Jacques', 'bucătarul și vizitiul lui Harpagon', 'male'],
    ['Comisarul', null, 'male'],
    // Tartuffe: titles and the name lists
    ['Doamna Pernelle', null, 'female'],
    ['Domnul Loyal', null, 'male'],
    ['Dorine', null, 'female'],
    ['Elmire', null, 'female'],
    ['Cléante', null, 'male'],
    ['Tartuffe', null, 'male'],
    ['Orgon', null, 'male'],
    ['Damis', null, 'male'],
    ['Căpitanul', null, 'male'],
    // Don Juan
    ['Dona Elvira', null, 'female'],
    ['Don Carlos', null, 'male'],
    ['Charlotte', null, 'female'],
    ['Mathurine', null, 'female'],
    ['Pierrot', null, 'male'],
    ['Omul Sărac', null, 'male'],
    ['Stafia', null, 'female'],
    ['La Violette', null, 'unknown'],
    // Vrăjitoarele din Salem
    ['Abigail', null, 'female'],
    ['Tituba', null, 'female'],
    ['Susanna', null, 'female'],
    ['Parris', null, 'male'],
    // Caragiale and Chekhov
    ['Zoe', null, 'female'],
    ['Veta', null, 'female'],
    ['Rică Venturiano', null, 'male'],
    ['Ghiță Pristanda', null, 'male'],
    ['Trahanache', null, 'male'],
    ['Cațavencu', null, 'male'],
    ['Cetățeanul turmentat', null, 'male'],
    ['Mița Baston', null, 'female'],
    ['Unchiul Vania', null, 'male'],
    ['Vania', null, 'male'],
    ['Liubov Andreievna', null, 'female'],
    ['Luca', null, 'male'],
    // notes that open with an article
    ['X', 'o văduvă bogată', 'female'],
    ['X', 'un tânăr ofițer', 'male'],
    // undecidable
    ['', null, 'unknown'],
  ])('%s (%s) → %s', (name, description, expected) => {
    expect(genderOf(name, description)).toBe(expected);
  });

  it('reads names printed in capitals', () => {
    expect(genderOf('DOAMNA PERNELLE')).toBe('female');
    expect(genderOf('JUPÂNUL JACQUES')).toBe('male');
  });
});
