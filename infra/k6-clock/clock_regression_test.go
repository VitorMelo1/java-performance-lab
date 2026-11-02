package httpext

import (
	"net/http/httptrace"
	"sync/atomic"
	"testing"
	"time"
)

// Only the regression build replaces time.Now() calls in tracer.go with this
// function. The production binary contains neither this seam nor this test.
var labCivilOffset int64

func labCivilNow() time.Time {
	return time.Now().Add(time.Duration(atomic.LoadInt64(&labCivilOffset)))
}

func TestLabClockStep(t *testing.T) {
	for _,offset := range []time.Duration{-time.Hour, time.Hour} {
		t.Run(offset.String(),func(t *testing.T) {
			atomic.StoreInt64(&labCivilOffset,0)
			defer atomic.StoreInt64(&labCivilOffset,0)
			tracer := &Tracer{}
			tracer.GetConn("local")
			tracer.gotConn = now()
			tracer.WroteRequest(httptrace.WroteRequestInfo{})
			tracer.GotFirstResponseByte()
			time.Sleep(5*time.Millisecond)
			atomic.StoreInt64(&labCivilOffset,int64(offset))
			trail := tracer.Done()
			if trail.Receiving < time.Millisecond || trail.Receiving > time.Second ||
				trail.Duration < time.Millisecond || trail.Duration > time.Second {
				t.Fatalf("CLOCK_STEP_CORRUPTED_DURATION: receiving=%s duration=%s",trail.Receiving,trail.Duration)
			}
		})
	}
}
