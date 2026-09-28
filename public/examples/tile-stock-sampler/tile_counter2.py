"""
tile_counter.py

Simple tile counter for images containing rectangular/square colored tiles.

Install:
    pip install opencv-python numpy pandas

Run:
    python tile_counter2.py "source_image2.jpg" in Windows PowerShell

Output:
    tile_results/tile_counts.csv
"""

import cv2
import numpy as np
import pandas as pd
import sys
from pathlib import Path


# Approximate colors used in the sample image, in RGB.
# Edit these if your real tiles use different colors.
PALETTE = {
    "dark blue":  (34, 83, 144),
    "light blue": (106, 144, 179),
    "green":      (77, 110, 80),
    "yellow":     (218, 169, 50),
    "red/orange": (195, 70, 43),
    "dark gray":  (58, 57, 60),
    "gray":       (133, 129, 127),
    "white":      (215, 209, 203),
}


def nearest_color(rgb):
    """Return the palette color closest to an RGB value."""

    rgb = np.array(rgb, dtype=float)

    best_name = None
    best_distance = float("inf")

    for name, color in PALETTE.items():

        distance = np.linalg.norm(
            rgb - np.array(color, dtype=float)
        )

        if distance < best_distance:
            best_distance = distance
            best_name = name

    return best_name


def detect_tiles(image_path, k=9, min_area=5000):

    image = cv2.imread(str(image_path))

    if image is None:
        raise FileNotFoundError(
            f"Could not read image: {image_path}"
        )

    # OpenCV loads BGR.
    # Convert to RGB for color processing.
    rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    # ------------------------------------------------------------
    # 1. K-means color segmentation
    # ------------------------------------------------------------

    # Reduce the image to a small version for faster clustering.
    small = cv2.resize(
        rgb,
        None,
        fx=0.25,
        fy=0.25
    )

    pixels = small.reshape(
        -1,
        3
    ).astype(np.float32)

    criteria = (
        cv2.TERM_CRITERIA_EPS
        + cv2.TERM_CRITERIA_MAX_ITER,
        100,
        0.2,
    )

    _, _, centers = cv2.kmeans(
        pixels,
        k,
        None,
        criteria,
        10,
        cv2.KMEANS_PP_CENTERS,
    )

    centers = np.uint8(centers)

    # Assign every full-resolution pixel
    # to its nearest cluster.
    pixels_full = rgb.reshape(
        -1,
        3
    ).astype(np.float32)

    distances = (
        (
            pixels_full[:, None, :]
            - centers[None, :, :]
        ) ** 2
    ).sum(axis=2)

    labels = np.argmin(
        distances,
        axis=1
    )

    labels = labels.reshape(
        rgb.shape[:2]
    ).astype(np.uint8)

    # ------------------------------------------------------------
    # 2. Detect tile boundaries
    # ------------------------------------------------------------

    # The sample image has thin grout/boundary lines.
    # Detecting edges and removing them prevents
    # neighboring tiles from merging.

    blurred = cv2.GaussianBlur(
        image,
        (5, 5),
        0
    )

    edges = cv2.Canny(
        blurred,
        20,
        70
    )

    edge_barrier = cv2.dilate(
        edges,
        np.ones((3, 3), np.uint8),
        iterations=1,
    )

    detections = []

    # ------------------------------------------------------------
    # 3. Find connected regions for each color
    # ------------------------------------------------------------

    for cluster_id in range(k):

        mask = (
            labels == cluster_id
        ).astype(np.uint8)

        # Remove detected grout/edge pixels.
        mask[edge_barrier > 0] = 0

        n_labels, component_labels, stats, centroids = (
            cv2.connectedComponentsWithStats(
                mask,
                8
            )
        )

        for component_id in range(
            1,
            n_labels
        ):

            x, y, w, h, area = (
                stats[component_id]
            )

            # Ignore small regions caused
            # by texture/noise.
            if area < min_area:
                continue

            # Ignore very thin regions.
            if w < 10 or h < 10:
                continue

            # Tile-like regions should have
            # a reasonably rectangular bounding box.
            rectangularity = (
                area / float(w * h)
            )

            if rectangularity < 0.55:
                continue

            component_mask = (
                component_labels
                == component_id
            )

            # Mean RGB value from the detected tile.
            mean_rgb = rgb[
                component_mask
            ].mean(axis=0)

            color_name = nearest_color(
                mean_rgb
            )

            cx, cy = centroids[
                component_id
            ]

            detections.append({
                "x": int(x),
                "y": int(y),
                "width": int(w),
                "height": int(h),
                "area_px": int(area),
                "center_x": round(
                    float(cx),
                    1
                ),
                "center_y": round(
                    float(cy),
                    1
                ),
                "mean_R": round(
                    float(mean_rgb[0]),
                    1
                ),
                "mean_G": round(
                    float(mean_rgb[1]),
                    1
                ),
                "mean_B": round(
                    float(mean_rgb[2]),
                    1
                ),
                "color": color_name,
            })

    # Sort spatially:
    # top-to-bottom, then left-to-right.
    detections.sort(
        key=lambda d: (
            d["center_y"],
            d["center_x"]
        )
    )

    # Give every tile an ID.
    for i, detection in enumerate(
        detections,
        start=1
    ):
        detection["tile_id"] = i

    return detections


def save_results(detections, output_dir):

    output_dir = Path(output_dir)

    # Create the output folder if it doesn't exist.
    output_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    # ------------------------------------------------------------
    # CSV
    # ------------------------------------------------------------

    df = pd.DataFrame(
        detections
    )

    columns = [
        "tile_id",
        "color",
        "x",
        "y",
        "width",
        "height",
        "area_px",
        "center_x",
        "center_y",
        "mean_R",
        "mean_G",
        "mean_B",
    ]

    df = pd.DataFrame(
        detections,
        columns=columns
)

    csv_path = (
        output_dir
        / "tile_counts2.csv"
    )

    df.to_csv(
        csv_path,
        index=False
    )

    # ------------------------------------------------------------
    # Summary printed to terminal
    # ------------------------------------------------------------

    print()
    print("Detected tiles:")
    print("----------------")

    counts = (
        df["color"]
        .value_counts()
    )

    for color, count in counts.items():

        print(
            f"{color:12s}: {count}"
        )

    print()
    print(
        f"TOTAL        : {len(df)}"
    )

    return csv_path


def main():

    # ------------------------------------------------------------
    # Check that an image was provided.
    # ------------------------------------------------------------

    if len(sys.argv) < 2:

        print("Usage:")
        print(
            "    python tile_counter.py image.jpg"
        )

        return

    # Get image path from command line.
    image_path = Path(
        sys.argv[1]
    )

    # Check that the file exists.
    if not image_path.exists():

        print(
            f"ERROR: Image not found:"
        )

        print(
            f"    {image_path}"
        )

        return

    print()
    print("Processing image...")
    print(
        f"Input: {image_path}"
    )

    # ------------------------------------------------------------
    # Detect tiles.
    # ------------------------------------------------------------

    detections = detect_tiles(
        image_path,
        k=9,
        min_area=100,
    )

    # ------------------------------------------------------------
    # Save CSV.
    # ------------------------------------------------------------

    csv_path = save_results(
        detections,
        output_dir="tile_results",
    )

    print()
    print("Saved:")
    print(
        f"    {csv_path.resolve()}"
    )


if __name__ == "__main__":
    main()