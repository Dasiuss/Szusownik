#include "list_buffer.h"
#include <string.h>

namespace core {

size_t listInsert(ListEntry* out, size_t count, size_t maxCount, const char* name, unsigned long size) {
  if (maxCount == 0) return count;
  size_t pos = 0;
  while (pos < count && strcmp(out[pos].name, name) < 0) pos++;
  if (pos >= maxCount) return count;  // nowszy niż wszystkie trzymane — poza oknem
  size_t newCount = count < maxCount ? count + 1 : count;
  for (size_t j = newCount - 1; j > pos; --j) out[j] = out[j - 1];
  strncpy(out[pos].name, name, sizeof(out[pos].name) - 1);
  out[pos].name[sizeof(out[pos].name) - 1] = '\0';
  out[pos].size = size;
  return newCount;
}

}  // namespace core
