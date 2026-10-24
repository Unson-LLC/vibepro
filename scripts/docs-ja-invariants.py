#!/usr/bin/env python3
"""Fail if a Japanese rewrite changed numbers, negations, or dropped subjects.

Usage: scripts/docs-ja-invariants.py <original> <final>

yomiyasu_diff compares sentence by sentence and can miss a flipped negation
when the matched sentence already had another negation. This check counts
over the whole document instead:
- numbers: the multiset of numbers must be equal.
- negations: the count of each negation form must be equal.
- subjects: each "<noun>は" / "<noun>が" topic or subject must appear at
  least as often as before (splitting a sentence may repeat a subject).
It prints the subject counts that changed so a reviewer can read them.
Exit 0 when all hold, 1 otherwise, 2 on usage errors.
"""
import re
import sys
from collections import Counter

NEGATIONS = ["ません", "ない", "なく", "ず", "不可", "不要", "未"]
NUM = re.compile(r"[0-9０-９]+(?:[.．][0-9０-９]+)?")
# A subject candidate: a run of kanji, katakana, latin, digits or backticked
# code, directly before は or が, and not part of a longer kana word.
SUBJ = re.compile(r"(`[^`]+`|[A-Za-z0-9_\-\u30A0-\u30FF\u4E00-\u9FFF]+)(?:は|が)(?![\u3041-\u3093])")
CODE = re.compile(r"```.*?```", re.S)


def load(path):
	with open(path, encoding="utf-8") as f:
		return CODE.sub("", f.read())


def main():
	if len(sys.argv) != 3:
		print(__doc__.strip().splitlines()[2], file=sys.stderr)
		return 2
	a, b = load(sys.argv[1]), load(sys.argv[2])
	ok = True

	na, nb = Counter(NUM.findall(a)), Counter(NUM.findall(b))
	if na != nb:
		ok = False
		print(f"NG numbers: removed {dict(na - nb)} added {dict(nb - na)}")
	else:
		print(f"OK numbers ({sum(na.values())})")

	for neg in NEGATIONS:
		ca, cb = a.count(neg), b.count(neg)
		if ca != cb:
			ok = False
			print(f"NG negation '{neg}': {ca} -> {cb}")
	if ok:
		print("OK negations")

	sa, sb = Counter(SUBJ.findall(a)), Counter(SUBJ.findall(b))
	dropped = {k: (v, sb[k]) for k, v in sa.items() if sb[k] < v}
	added = {k: (sa[k], v) for k, v in sb.items() if v > sa[k]}
	if dropped:
		ok = False
		print(f"NG subjects dropped (before, after): {dropped}")
	else:
		print("OK subjects kept")
	if added:
		print(f"REVIEW subjects added (before, after): {added}")

	return 0 if ok else 1


if __name__ == "__main__":
	sys.exit(main())
