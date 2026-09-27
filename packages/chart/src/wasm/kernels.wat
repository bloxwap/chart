;; chart-ts WASM kernels: SIMD-accelerated hot math paths.
;; Layout convention: floats live in linear memory at byte offsets passed as i32.
;; Multi-value results are used for min/max pairs.

(module
  (memory (export "memory") 1)

  ;; ---------------------------------------------------------------------------
  ;; minmax_f32(ptr, len) -> (f32, f32)
  ;; SIMD min/max reduction over a contiguous f32 array. NaN-free data assumed.
  ;; Returns (nan, nan) for len = 0.
  ;; ---------------------------------------------------------------------------
  (func $minmax_f32 (export "minmax_f32") (param $ptr i32) (param $len i32) (result f32 f32)
    (local $i i32)
    (local $vmin v128)
    (local $vmax v128)
    (local $min f32)
    (local $max f32)
    (if (i32.eqz (local.get $len))
      (then (return (f32.const nan) (f32.const nan))))
    (local.set $min (f32.load (local.get $ptr)))
    (local.set $max (f32.load (local.get $ptr)))
    (local.set $vmin (f32x4.splat (local.get $min)))
    (local.set $vmax (f32x4.splat (local.get $max)))
    (local.set $i (i32.const 0))
    ;; vector body: while i + 4 <= len
    (block $vdone
      (loop $vloop
        (br_if $vdone (i32.gt_u (i32.add (local.get $i) (i32.const 4)) (local.get $len)))
        (local.set $vmin
          (f32x4.min (local.get $vmin)
            (v128.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $vmax
          (f32x4.max (local.get $vmax)
            (v128.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $vloop)))
    ;; horizontal reduce of the 4 lanes
    (local.set $min
      (f32.min
        (f32.min (f32x4.extract_lane 0 (local.get $vmin)) (f32x4.extract_lane 1 (local.get $vmin)))
        (f32.min (f32x4.extract_lane 2 (local.get $vmin)) (f32x4.extract_lane 3 (local.get $vmin)))))
    (local.set $max
      (f32.max
        (f32.max (f32x4.extract_lane 0 (local.get $vmax)) (f32x4.extract_lane 1 (local.get $vmax)))
        (f32.max (f32x4.extract_lane 2 (local.get $vmax)) (f32x4.extract_lane 3 (local.get $vmax)))))
    ;; scalar tail
    (block $tdone
      (loop $tloop
        (br_if $tdone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $min
          (f32.min (local.get $min)
            (f32.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $max
          (f32.max (local.get $max)
            (f32.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tloop)))
    (return (local.get $min) (local.get $max)))

  ;; ---------------------------------------------------------------------------
  ;; minmax_f32_scalar(ptr, len) -> (f32, f32)
  ;; Scalar fallback export for engines without SIMD (the JS caller may also
  ;; fall back to plain JS; this export keeps the module self-sufficient).
  ;; ---------------------------------------------------------------------------
  (func $minmax_f32_scalar (export "minmax_f32_scalar") (param $ptr i32) (param $len i32) (result f32 f32)
    (local $i i32)
    (local $min f32)
    (local $max f32)
    (local $v f32)
    (if (i32.eqz (local.get $len))
      (then (return (f32.const nan) (f32.const nan))))
    (local.set $min (f32.load (local.get $ptr)))
    (local.set $max (f32.load (local.get $ptr)))
    (local.set $i (i32.const 1))
    (block $done
      (loop $loop
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $v (f32.load (i32.add (local.get $ptr) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $min (f32.min (local.get $min) (local.get $v)))
        (local.set $max (f32.max (local.get $max) (local.get $v)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)))
    (return (local.get $min) (local.get $max)))

  ;; ---------------------------------------------------------------------------
  ;; sma_f32(src, dst, len, period)
  ;; Simple moving average. dst[i] = NaN for i < period - 1.
  ;; Sliding-window update: O(len) additions total.
  ;; ---------------------------------------------------------------------------
  (func $sma_f32 (export "sma_f32") (param $src i32) (param $dst i32) (param $len i32) (param $period i32)
    (local $i i32)
    (local $sum f32)
    (local $pinv f32)
    ;; NaN-fill dst[0 .. min(period-1, len))
    (local.set $i (i32.const 0))
    (block $fdone
      (loop $floop
        (br_if $fdone (i32.ge_u (local.get $i) (i32.sub (local.get $period) (i32.const 1))))
        (br_if $fdone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (f32.const nan))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $floop)))
    ;; nothing more to do when len < period
    (if (i32.lt_u (local.get $len) (local.get $period)) (then return))
    (local.set $pinv (f32.div (f32.const 1) (f32.convert_i32_u (local.get $period))))
    ;; seed: sum of src[0 .. period)
    (local.set $sum (f32.const 0))
    (local.set $i (i32.const 0))
    (block $sdone
      (loop $sloop
        (br_if $sdone (i32.ge_u (local.get $i) (local.get $period)))
        (local.set $sum
          (f32.add (local.get $sum)
            (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $sloop)))
    (f32.store
      (i32.add (local.get $dst) (i32.shl (i32.sub (local.get $period) (i32.const 1)) (i32.const 2)))
      (f32.mul (local.get $sum) (local.get $pinv)))
    ;; slide: dst[i] = dst[i-1] + (src[i] - src[i-period]) / period
    (local.set $i (local.get $period))
    (block $mdone
      (loop $mloop
        (br_if $mdone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $sum
          (f32.add (local.get $sum)
            (f32.sub
              (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2))))
              (f32.load (i32.add (local.get $src)
                (i32.shl (i32.sub (local.get $i) (local.get $period)) (i32.const 2)))))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2)))
          (f32.mul (local.get $sum) (local.get $pinv)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $mloop))))

  ;; ---------------------------------------------------------------------------
  ;; ema_f32(src, dst, len, period)
  ;; Exponential moving average, k = 2 / (period + 1), seeded with the SMA of
  ;; the first `period` values at index period - 1; NaN before that.
  ;; ---------------------------------------------------------------------------
  (func $ema_f32 (export "ema_f32") (param $src i32) (param $dst i32) (param $len i32) (param $period i32)
    (local $i i32)
    (local $sum f32)
    (local $k f32)
    (local $prev f32)
    ;; NaN-fill dst[0 .. min(period-1, len))
    (local.set $i (i32.const 0))
    (block $fdone
      (loop $floop
        (br_if $fdone (i32.ge_u (local.get $i) (i32.sub (local.get $period) (i32.const 1))))
        (br_if $fdone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (f32.const nan))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $floop)))
    (if (i32.lt_u (local.get $len) (local.get $period)) (then return))
    (local.set $k
      (f32.div (f32.const 2) (f32.convert_i32_u (i32.add (local.get $period) (i32.const 1)))))
    ;; seed: SMA of src[0 .. period)
    (local.set $sum (f32.const 0))
    (local.set $i (i32.const 0))
    (block $sdone
      (loop $sloop
        (br_if $sdone (i32.ge_u (local.get $i) (local.get $period)))
        (local.set $sum
          (f32.add (local.get $sum)
            (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $sloop)))
    (local.set $prev (f32.div (local.get $sum) (f32.convert_i32_u (local.get $period))))
    (f32.store
      (i32.add (local.get $dst) (i32.shl (i32.sub (local.get $period) (i32.const 1)) (i32.const 2)))
      (local.get $prev))
    ;; ema[i] = src[i] * k + prev * (1 - k)
    (local.set $i (local.get $period))
    (block $mdone
      (loop $mloop
        (br_if $mdone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $prev
          (f32.add
            (f32.mul
              (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2))))
              (local.get $k))
            (f32.mul (local.get $prev) (f32.sub (f32.const 1) (local.get $k)))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (local.get $prev))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $mloop))))

  ;; ---------------------------------------------------------------------------
  ;; rolling_max_f32(src, dst, tmp, len, period)
  ;; Sliding-window maximum over `period` values (van Herk/Gil-Werman): block
  ;; prefix maxima go to dst, block suffix maxima to tmp (len floats of
  ;; scratch), then dst[i] = max(tmp[i-period+1], dst[i]) in a SIMD pass.
  ;; O(len) regardless of period. dst[i] = NaN for i < period - 1, and a NaN
  ;; input poisons exactly the windows containing it. Needs 1 <= period.
  ;; ---------------------------------------------------------------------------
  (func $rolling_max_f32 (export "rolling_max_f32")
    (param $src i32) (param $dst i32) (param $tmp i32) (param $len i32) (param $period i32)
    (local $i i32)
    (local $k i32)
    (local $acc f32)
    (local $v f32)
    ;; forward pass: prefix maxima restarting every `period` values
    (local.set $i (i32.const 0))
    (local.set $k (i32.const 0))
    (block $fdone
      (loop $floop
        (br_if $fdone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $v (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $acc
          (select (local.get $v) (f32.max (local.get $acc) (local.get $v)) (i32.eqz (local.get $k))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (local.get $acc))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (if (i32.eq (local.get $k) (local.get $period)) (then (local.set $k (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $floop)))
    ;; backward pass: suffix maxima within the same blocks
    (local.set $i (local.get $len))
    (local.set $k (i32.rem_u (local.get $len) (local.get $period)))
    (block $bdone
      (loop $bloop
        (br_if $bdone (i32.eqz (local.get $i)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (local.set $v (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2)))))
        ;; k counts down within the block; k = 0 marks the block's last value
        ;; (or the final partial block's end).
        (if (i32.eqz (local.get $k)) (then (local.set $k (local.get $period))))
        (local.set $acc
          (select (local.get $v) (f32.max (local.get $acc) (local.get $v))
            (i32.or (i32.eq (local.get $k) (local.get $period)) (i32.eq (local.get $i) (i32.sub (local.get $len) (i32.const 1))))))
        (f32.store (i32.add (local.get $tmp) (i32.shl (local.get $i) (i32.const 2))) (local.get $acc))
        (local.set $k (i32.sub (local.get $k) (i32.const 1)))
        (br $bloop)))
    ;; combine: windows [i-period+1, i] = suffix(i-period+1) + prefix(i); SIMD by 4
    (local.set $i (i32.sub (local.get $period) (i32.const 1)))
    (block $vdone
      (loop $vloop
        (br_if $vdone (i32.gt_u (i32.add (local.get $i) (i32.const 4)) (local.get $len)))
        (v128.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2)))
          (f32x4.max
            (v128.load (i32.add (local.get $tmp)
              (i32.shl (i32.add (i32.sub (local.get $i) (local.get $period)) (i32.const 1)) (i32.const 2))))
            (v128.load (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $vloop)))
    (block $tdone
      (loop $tloop
        (br_if $tdone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2)))
          (f32.max
            (f32.load (i32.add (local.get $tmp)
              (i32.shl (i32.add (i32.sub (local.get $i) (local.get $period)) (i32.const 1)) (i32.const 2))))
            (f32.load (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tloop)))
    ;; warmup: NaN-fill dst[0 .. min(period-1, len))
    (local.set $i (i32.const 0))
    (block $ndone
      (loop $nloop
        (br_if $ndone (i32.ge_u (local.get $i) (i32.sub (local.get $period) (i32.const 1))))
        (br_if $ndone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (f32.const nan))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $nloop))))

  ;; ---------------------------------------------------------------------------
  ;; rolling_min_f32(src, dst, tmp, len, period)
  ;; Sliding-window minimum over `period` values (van Herk/Gil-Werman): block
  ;; prefix minima go to dst, block suffix minima to tmp (len floats of
  ;; scratch), then dst[i] = min(tmp[i-period+1], dst[i]) in a SIMD pass.
  ;; O(len) regardless of period. dst[i] = NaN for i < period - 1, and a NaN
  ;; input poisons exactly the windows containing it. Needs 1 <= period.
  ;; ---------------------------------------------------------------------------
  (func $rolling_min_f32 (export "rolling_min_f32")
    (param $src i32) (param $dst i32) (param $tmp i32) (param $len i32) (param $period i32)
    (local $i i32)
    (local $k i32)
    (local $acc f32)
    (local $v f32)
    ;; forward pass: prefix minima restarting every `period` values
    (local.set $i (i32.const 0))
    (local.set $k (i32.const 0))
    (block $fdone
      (loop $floop
        (br_if $fdone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $v (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2)))))
        (local.set $acc
          (select (local.get $v) (f32.min (local.get $acc) (local.get $v)) (i32.eqz (local.get $k))))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (local.get $acc))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (if (i32.eq (local.get $k) (local.get $period)) (then (local.set $k (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $floop)))
    ;; backward pass: suffix minima within the same blocks
    (local.set $i (local.get $len))
    (local.set $k (i32.rem_u (local.get $len) (local.get $period)))
    (block $bdone
      (loop $bloop
        (br_if $bdone (i32.eqz (local.get $i)))
        (local.set $i (i32.sub (local.get $i) (i32.const 1)))
        (local.set $v (f32.load (i32.add (local.get $src) (i32.shl (local.get $i) (i32.const 2)))))
        ;; k counts down within the block; k = 0 marks the block's last value
        ;; (or the final partial block's end).
        (if (i32.eqz (local.get $k)) (then (local.set $k (local.get $period))))
        (local.set $acc
          (select (local.get $v) (f32.min (local.get $acc) (local.get $v))
            (i32.or (i32.eq (local.get $k) (local.get $period)) (i32.eq (local.get $i) (i32.sub (local.get $len) (i32.const 1))))))
        (f32.store (i32.add (local.get $tmp) (i32.shl (local.get $i) (i32.const 2))) (local.get $acc))
        (local.set $k (i32.sub (local.get $k) (i32.const 1)))
        (br $bloop)))
    ;; combine: windows [i-period+1, i] = suffix(i-period+1) + prefix(i); SIMD by 4
    (local.set $i (i32.sub (local.get $period) (i32.const 1)))
    (block $vdone
      (loop $vloop
        (br_if $vdone (i32.gt_u (i32.add (local.get $i) (i32.const 4)) (local.get $len)))
        (v128.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2)))
          (f32x4.min
            (v128.load (i32.add (local.get $tmp)
              (i32.shl (i32.add (i32.sub (local.get $i) (local.get $period)) (i32.const 1)) (i32.const 2))))
            (v128.load (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 4)))
        (br $vloop)))
    (block $tdone
      (loop $tloop
        (br_if $tdone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2)))
          (f32.min
            (f32.load (i32.add (local.get $tmp)
              (i32.shl (i32.add (i32.sub (local.get $i) (local.get $period)) (i32.const 1)) (i32.const 2))))
            (f32.load (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tloop)))
    ;; warmup: NaN-fill dst[0 .. min(period-1, len))
    (local.set $i (i32.const 0))
    (block $ndone
      (loop $nloop
        (br_if $ndone (i32.ge_u (local.get $i) (i32.sub (local.get $period) (i32.const 1))))
        (br_if $ndone (i32.ge_u (local.get $i) (local.get $len)))
        (f32.store (i32.add (local.get $dst) (i32.shl (local.get $i) (i32.const 2))) (f32.const nan))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $nloop))))
)
