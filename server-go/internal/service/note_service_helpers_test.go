package service

import (
	"testing"

	"github.com/google/uuid"
)

func TestNormalizeFolderPath(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   string
		want string
	}{
		{in: "", want: "/"},
		{in: "   /", want: "/"},
		{in: "dev/go", want: "/dev/go"},
		{in: "\\dev\\go\\", want: "/dev/go"},
		{in: " /a//b/ ", want: "/a/b"},
	}

	for _, item := range cases {
		if got := normalizeFolderPath(item.in); got != item.want {
			t.Fatalf("normalizeFolderPath(%q) = %q, want %q", item.in, got, item.want)
		}
	}
}

func TestSanitizeFolderName(t *testing.T) {
	t.Parallel()

	if _, err := sanitizeFolderName("/"); err == nil {
		t.Fatalf("expected error for root-like name")
	}
	if _, err := sanitizeFolderName("a/b"); err == nil {
		t.Fatalf("expected error for slash name")
	}
	if got, err := sanitizeFolderName("  Work  "); err != nil || got != "Work" {
		t.Fatalf("sanitizeFolderName returned (%q, %v), want (Work, nil)", got, err)
	}
}

func TestBuildFolderPath(t *testing.T) {
	t.Parallel()

	if got := buildFolderPath("/", "Coding"); got != "/Coding" {
		t.Fatalf("got %q", got)
	}
	if got := buildFolderPath("/Coding", "Go"); got != "/Coding/Go" {
		t.Fatalf("got %q", got)
	}
	if got := buildFolderPath("/Coding", ""); got != "/Coding" {
		t.Fatalf("got %q", got)
	}
}

func TestParseFlexibleUUID(t *testing.T) {
	t.Parallel()

	id := uuid.New()
	if parsed, err := parseFlexibleUUID(id.String()); err != nil || parsed == nil || *parsed != id {
		t.Fatalf("parse string uuid failed: parsed=%v err=%v", parsed, err)
	}

	if parsed, err := parseFlexibleUUID("   "); err != nil || parsed != nil {
		t.Fatalf("parse empty uuid expected nil, got parsed=%v err=%v", parsed, err)
	}

	if _, err := parseFlexibleUUID("invalid-uuid"); err == nil {
		t.Fatalf("expected error for invalid uuid")
	}
}

func TestInsertUUIDAtAndClamp(t *testing.T) {
	t.Parallel()

	a := uuid.New()
	b := uuid.New()
	c := uuid.New()

	list := []uuid.UUID{a, b}
	inserted := insertUUIDAt(list, c, 1)
	if len(inserted) != 3 {
		t.Fatalf("len(inserted)=%d", len(inserted))
	}
	if inserted[0] != a || inserted[1] != c || inserted[2] != b {
		t.Fatalf("unexpected order: %#v", inserted)
	}

	insertedFront := insertUUIDAt(list, c, -4)
	if insertedFront[0] != c {
		t.Fatalf("expected front insert")
	}

	insertedTail := insertUUIDAt(list, c, 99)
	if insertedTail[len(insertedTail)-1] != c {
		t.Fatalf("expected tail insert")
	}
}

func TestUUIDPtrEqual(t *testing.T) {
	t.Parallel()

	id := uuid.New()
	other := uuid.New()

	if !uuidPtrEqual(nil, nil) {
		t.Fatalf("nil,nil should be equal")
	}
	if uuidPtrEqual(&id, nil) {
		t.Fatalf("id,nil should not be equal")
	}
	if !uuidPtrEqual(&id, &id) {
		t.Fatalf("same pointer value should be equal")
	}
	if uuidPtrEqual(&id, &other) {
		t.Fatalf("different values should not be equal")
	}
}
