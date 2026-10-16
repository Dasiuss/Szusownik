#include "meta_name.h"
#include <string.h>

namespace core {

bool csvNameFromMeta(const char* name, const char* suffix, char* out, size_t outLen) {
  if (!name || !suffix || !out || outLen == 0) return false;
  const size_t nameLen = strlen(name);
  const size_t suffixLen = strlen(suffix);
  // Baza musi być niepusta (`.meta` bez nazwy to nie plik CSV).
  if (suffixLen == 0 || nameLen <= suffixLen) return false;
  if (strcmp(name + nameLen - suffixLen, suffix) != 0) return false;
  size_t baseLen = nameLen - suffixLen;
  if (baseLen >= outLen) baseLen = outLen - 1;  // obetnij do pojemności bufora
  memcpy(out, name, baseLen);
  out[baseLen] = '\0';
  return true;
}

}  // namespace core
