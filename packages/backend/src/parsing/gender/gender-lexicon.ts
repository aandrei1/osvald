/**
 * Word lists for the rule-based gender classifier.
 *
 * Every entry is lowercase with diacritics stripped, matching `normalize()` in
 * the classifier. The name lists only need names the suffix rules get wrong or
 * cannot decide: a Romanian `-a` name is already female and a consonant ending
 * already male, so the lists are mostly `-e`/`-y` names and exceptions.
 */

/** Titles and role nouns that fix the gender wherever they lead a name or note. */
export const FEMALE_ROLE_WORDS: ReadonlySet<string> = new Set([
  // titles
  'doamna', 'domnisoara', 'duduia', 'coana', 'cucoana', 'cocoana', 'madam', 'madame',
  'mademoiselle', 'dona', 'donna', 'lady', 'miss', 'mrs', 'ms', 'regina', 'printesa',
  'contesa', 'ducesa', 'baroneasa', 'imparateasa', 'jupaneasa', 'boieroaica',
  // family and household
  'mama', 'mamica', 'fiica', 'fata', 'fetita', 'sora', 'sotia', 'nevasta', 'mireasa',
  'bunica', 'matusa', 'nepoata', 'verisoara', 'iubita', 'logodnica', 'vaduva', 'nora',
  'soacra', 'cumnata', 'fina', 'nasa', 'stapana', 'vecina', 'prietena',
  'servitoarea', 'slujnica', 'camerista', 'menajera', 'doica', 'guvernanta',
  'bucatareasa', 'spalatoreasa', 'croitoreasa', 'hangita',
  // people
  'femeia', 'femeie', 'femeile', 'batrana', 'tanara', 'petitoare', 'petitoarea',
  'vrajitoarea', 'calugarita', 'stareta', 'tiganca', 'taranca', 'cersetoarea',
  'pastorita', 'zana', 'actrita', 'cantareata', 'dansatoarea', 'invatatoarea',
  'profesoara', 'doctorita', 'infirmiera',
]);

export const MALE_ROLE_WORDS: ReadonlySet<string> = new Set([
  // titles
  'domnul', 'domnu', 'jupanul', 'jupan', 'don', 'monsieur', 'sir', 'lord', 'mister', 'mr',
  'regele', 'contele', 'ducele', 'printul', 'baronul', 'imparatul', 'cneazul', 'boierul',
  'voda', 'parintele', 'popa',
  // family and household (-le and -a nouns the article rule misses)
  'tata', 'tatal', 'fratele', 'ginerele', 'mirele', 'sluga', 'barbat', 'barbatul',
  'baiat', 'baiatul', 'fiul', 'sotul', 'unchiul', 'bunicul', 'nepotul', 'varul',
  'iubitul', 'logodnicul', 'servitorul', 'valetul', 'lacheul', 'feciorul',
]);

/** Particles that start a name without saying anything about its owner (`La Flèche`). */
export const NAME_PARTICLES: ReadonlySet<string> = new Set([
  'la', 'le', 'de', 'du', 'des', 'van', 'von', 'di', 'da', 'del',
]);

export const FEMALE_NAMES: ReadonlySet<string> = new Set([
  // Romanian and Caragiale
  'zoe', 'aglae', 'veta', 'zita', 'mita', 'safta', 'catinca', 'smaranda', 'ruxandra',
  // French and Molière
  'alice', 'adele', 'agnes', 'ines', 'beatrice', 'celimene', 'elise', 'mariane', 'marianne',
  'dorine', 'elmire', 'frosine', 'charlotte', 'mathurine', 'henriette', 'armande',
  'belise', 'philaminte', 'martine', 'lucile', 'angelique', 'toinette', 'isabelle',
  'nicole', 'claudine', 'cathos', 'madelon', 'georgette', 'lisette', 'marton', 'nerine',
  'zerbinette', 'hyacinthe', 'celie', 'marie', 'sophie', 'julie', 'lucie', 'louise',
  'jeanne', 'anne', 'catherine', 'madeleine', 'genevieve', 'michele', 'estelle',
  'gabrielle', 'danielle', 'juliette', 'colette', 'yvonne', 'helene', 'irene', 'rose',
  // English, Shakespeare, Miller
  'abigail', 'ann', 'jane', 'kate', 'grace', 'janet', 'harriet', 'margaret', 'elizabeth',
  'elisabeth', 'judith', 'edith', 'rachel', 'esther', 'ester', 'ruth', 'miriam', 'carmen',
  'ingrid', 'astrid', 'mabel', 'isabel', 'gertrude', 'juliet', 'goneril', 'regan',
  'rosalind', 'imogen', 'hero', 'hermione', 'mary', 'betty', 'nancy', 'lucy', 'sally',
  'polly', 'peggy', 'kitty', 'dolly', 'emily', 'amy', 'judy', 'molly', 'wendy', 'mercy',
  'abby', 'cathy', 'kathy', 'lily', 'daisy', 'ivy', 'joy', 'linda', 'blanche', 'stella',
  // Chekhov, Ibsen
  'liubov', 'kristine', 'thea',
  // -i/-o endings
  'naomi', 'mimi', 'lili', 'fifi', 'heidi', 'kiki', 'cleo', 'margo', 'juno',
]);

export const MALE_NAMES: ReadonlySet<string> = new Set([
  // Romanian -a/-e
  'luca', 'toma', 'mihnea', 'mircea', 'horia', 'horea', 'costea', 'sava', 'ilia', 'vasile',
  'gheorghe', 'ilie', 'petre', 'nae', 'manole', 'stere', 'dobre', 'sile', 'mache', 'tache',
  'take', 'panaite', 'tudose', 'radule',
  // Russian diminutives common in translations
  'vania', 'petea', 'mitea', 'grisa', 'kolea', 'fedea', 'iasa', 'kostea', 'misa',
  'nikita', 'foma', 'luka',
  // French and Molière
  'cleante', 'valere', 'anselme', 'tartuffe', 'dimanche', 'sganarelle', 'mascarille',
  'alceste', 'philinte', 'oronte', 'acaste', 'clitandre', 'arnolphe', 'horace',
  'chrysale', 'ariste', 'brindavoine', 'pierre', 'philippe', 'andre', 'etienne',
  'maxime', 'antoine', 'eugene', 'jerome', 'guillaume', 'rene', 'jacques',
  // English and Shakespeare
  'george', 'mike', 'joe', 'jake', 'steve', 'dave', 'pete', 'lawrence', 'feste', 'flute',
  'antony', 'toby', 'harry', 'henry', 'larry', 'jimmy', 'billy', 'tommy', 'danny',
  'johnny', 'eddie', 'willy', 'bobby', 'teddy', 'roy', 'guy', 'jerry', 'jeremy', 'rory',
  'barry', 'gary', 'terry',
]);

/** Romanian surname endings that, with no title in front, name a man. */
export const MALE_SURNAME_SUFFIXES: readonly string[] = ['escu', 'eanu', 'ache'];
