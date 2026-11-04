# Using

Tachyon provides a simple HTTP interface in the form of:

`https://{tachyon-domain}/my/image/path.png?w=100&h=80`

The path, without its leading slash, is the Object Key in the Origin. A first `/tachyon/` segment is removed, as in Tachyon. Originals under a Private Prefix also need the SigV4 presign WordPress generates, either as `presign=` or as raw `X-Amz-*` parameters.

Send `X-WebP: 1` to get WebP output without the `webp` argument.

## Args Reference

| URL Arg | Type | Description |
|---|----|---|
|`w`|Number|Max width of the image.|
|`h`|Number|Max height of the image.|
|`quality`|Number, 0-100|Image quality.|
|`resize`|String, "w,h"|A comma separated string of the target width and height in pixels. Crops the image.|
|`crop_strategy`|String, "smart", "entropy", "attention"|There are 3 automatic cropping strategies for use with `resize`: <ul><li>`attention`: good results, ~70% slower</li><li>`entropy`: mediocre results, ~30% slower</li><li>`smart`: best results, ~50% slower</li>|
|`gravity`|String|Alternative to `crop_strategy`. Crops are made from the center of the image by default, passing one of "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest" or "center" will crop from that edge.|
|`fit`|String, "w,h"|A comma separated string of the target maximum width and height. Does not crop the image.|
|`crop`|Boolean\|String, "x,y,w,h"|Crop an image by percentages x-offset, y-offset, width and height (x,y,w,h). Percentages are used so that you don’t need to recalculate the cropping when transforming the image in other ways such as resizing it. You can crop by pixel values too by appending `px` to the values. `crop=160px,160px,788px,788px` takes a 788 by 788 pixel square starting at 160 by 160.|
|`zoom`|Number|Zooms the image by the specified amount for high DPI displays. `zoom=2` produces an image twice the size specified in `w`, `h`, `fit` or `resize`. The quality is automatically reduced to keep file sizes roughly equivalent to the non-zoomed image unless the `quality` argument is passed.|
|`webp`|Boolean, 1|Force WebP format.|
|`lb`|String, "w,h"|Add letterboxing effect to images, by scaling them to width, height while maintaining the aspect ratio and filling the rest with black or `background`.|
|`background`|String|Letterbox colour as lowercase hex, escaped: `%23ff0000` or `%23f00`. Anything else, including colour names and unescaped hex, falls back to black (Tachyon v3.0.8 behaviour).|

## Responses

| Case | Status | Body and headers |
|---|---|---|
| Success | 200 | Image; `Content-Type` of the output format, `Cache-Control: max-age=31536000` (or the presign's remaining validity), `Last-Modified` |
| Missing Original, Private Prefix without a valid presign, expired presign | 404 | `File not found.`, `Content-Type: text/html` |
| Invalid arguments (e.g. crop outside the image), undecodable Original, processing failure | 500 | `Internal Server Error`, `Cache-Control: no-store` |
| HTTP Origin failure other than 403/404 | 502 | `Bad Gateway`, `Cache-Control: no-store` |

See the README for the documented differences from Tachyon v3.0.8.
