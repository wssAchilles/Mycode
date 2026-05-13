package reclaim

const StartCursor = "0-0"

type CursorTracker struct {
	cursors map[string]string
}

func NewCursorTracker() *CursorTracker {
	return &CursorTracker{cursors: map[string]string{}}
}

func (c *CursorTracker) Start(streamKey string) string {
	if c == nil {
		return StartCursor
	}
	cursor := c.cursors[streamKey]
	if cursor == "" {
		return StartCursor
	}
	return cursor
}

func (c *CursorTracker) Record(streamKey string, cursor string) {
	if c == nil {
		return
	}
	if c.cursors == nil {
		c.cursors = map[string]string{}
	}
	if cursor == "" {
		cursor = StartCursor
	}
	c.cursors[streamKey] = cursor
}
