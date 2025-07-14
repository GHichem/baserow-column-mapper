
// Simple Levenshtein distance calculation for fuzzy matching
export const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
};

// Calculate similarity percentage
export const calculateSimilarity = (str1: string, str2: string): number => {
  const normalizedStr1 = str1.toLowerCase().trim();
  const normalizedStr2 = str2.toLowerCase().trim();
  
  if (normalizedStr1 === normalizedStr2) return 100;
  
  const maxLength = Math.max(normalizedStr1.length, normalizedStr2.length);
  const distance = levenshteinDistance(normalizedStr1, normalizedStr2);
  
  return Math.round(((maxLength - distance) / maxLength) * 100);
};

// Find best matches for a column
export const findBestMatches = (userColumn: string, targetColumns: string[]): Array<{column: string, similarity: number}> => {
  return targetColumns
    .map(column => ({
      column,
      similarity: calculateSimilarity(userColumn, column)
    }))
    .sort((a, b) => b.similarity - a.similarity);
};

// Common column name variations
export const COLUMN_VARIATIONS: Record<string, string[]> = {
  'email': ['e-mail', 'e_mail', 'mail', 'email_address', 'email address'],
  'firstname': ['first_name', 'first name', 'vorname', 'given_name', 'fname'],
  'lastname': ['last_name', 'last name', 'nachname', 'surname', 'family_name', 'lname'],
  'company': ['unternehmen', 'firma', 'organization', 'organisation', 'business'],
  'phone': ['telefon', 'tel', 'telephone', 'mobile', 'handy'],
  'address': ['adresse', 'street', 'strasse', 'location'],
};

// Smart matching with common variations
export const smartMatch = (userColumn: string, targetColumns: string[]): string | null => {
  const normalizedUser = userColumn.toLowerCase().trim();
  
  // Direct match first
  const directMatch = targetColumns.find(col => col.toLowerCase().trim() === normalizedUser);
  if (directMatch) return directMatch;
  
  // Check variations
  for (const [standard, variations] of Object.entries(COLUMN_VARIATIONS)) {
    if (variations.includes(normalizedUser) || normalizedUser.includes(standard)) {
      const match = targetColumns.find(col => 
        col.toLowerCase().includes(standard) || 
        variations.some(v => col.toLowerCase().includes(v))
      );
      if (match) return match;
    }
  }
  
  // Fuzzy matching as fallback
  const bestMatches = findBestMatches(userColumn, targetColumns);
  if (bestMatches.length > 0 && bestMatches[0].similarity >= 70) {
    return bestMatches[0].column;
  }
  
  return null;
};
