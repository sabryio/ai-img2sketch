"""CLI interface for the AI Image to Sketch Video application."""

import logging
from importlib import resources as importlib_resources
from pathlib import Path

import click
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..application.services.dimension_adjuster import DimensionAdjuster
from ..application.services.video_path_resolver import VideoPathResolver
from ..application.use_cases.generate_batch_videos import BatchSummary
from ..domain.value_objects.video_config import VideoConfig
from .composition import (
    build_generate_sketch_video_use_case,
    build_generate_videos_from_directory_use_case,
    create_image_loader,
)

console = Console()


@click.group()
@click.version_option(version="0.1.0")
def cli() -> None:
    """AI Image to Sketch Video - Convert images to animated sketch videos."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")


@cli.command()
@click.argument("source", type=click.Path(exists=True, path_type=Path))
@click.option(
    "-o",
    "--output",
    type=click.Path(path_type=Path),
    default=None,
    help="Output directory (default: next to each image)",
)
@click.option(
    "--split-len",
    type=click.IntRange(5, 100),
    default=10,
    help="Grid split length (higher = faster sketch)",
)
@click.option(
    "--frame-rate",
    type=click.IntRange(1, 120),
    default=25,
    help="Video frame rate (fps)",
)
@click.option(
    "--object-skip-rate",
    type=click.IntRange(1, 100),
    default=8,
    help="Drawing skip rate (lower = more detailed)",
)
@click.option(
    "--draw-duration",
    type=click.FloatRange(min=0.1, max=600.0),
    default=None,
    help="Target seconds for the drawing phase (overrides --object-skip-rate)",
)
@click.option(
    "--end-duration",
    type=click.IntRange(0, 10),
    default=2,
    help="Duration to show final colored image (seconds)",
)
@click.option(
    "--hand-image",
    type=click.Path(exists=True, path_type=Path),
    default=None,
    help="Custom hand image path",
)
@click.option(
    "--hand-mask",
    type=click.Path(exists=True, path_type=Path),
    default=None,
    help="Custom hand mask path",
)
@click.option(
    "--object-masks",
    type=click.Path(exists=True, path_type=Path),
    default=None,
    help="JSON file describing ordered object masks (see README)",
)
def generate(
    source: Path,
    output: Path | None,
    split_len: int,
    frame_rate: int,
    object_skip_rate: int,
    draw_duration: float | None,
    end_duration: int,
    hand_image: Path | None,
    hand_mask: Path | None,
    object_masks: Path | None,
) -> None:
    """Generate sketch video(s) from an image or a folder of images.

    Pass an image file to produce a single video, or a folder to produce one
    video per image found directly inside it. Each video is named after its
    image (``photo.jpg`` -> ``photo.mp4``) and written next to it.

    Example:
        img2sketch generate input.jpg
        img2sketch generate ./photos --split-len 15 --frame-rate 30
        img2sketch generate input.jpg --draw-duration 5
    """
    exit_code = 0
    try:
        _print_banner()

        hand_image = hand_image or _bundled_image("drawing-hand.png")
        hand_mask = hand_mask or _bundled_image("hand-mask.png")
        _require_hand_files(hand_image, hand_mask)

        config = VideoConfig(
            frame_rate=frame_rate,
            split_len=split_len,
            object_skip_rate=object_skip_rate,
            draw_duration_sec=draw_duration,
            end_duration_sec=end_duration,
        )

        if source.is_dir():
            exit_code = _generate_directory(
                source, config, output, object_masks, hand_image, hand_mask
            )
        else:
            _generate_single(source, config, output, object_masks, hand_image, hand_mask)

    except click.Abort:
        raise
    except Exception as e:
        console.print(f"\n[bold red]Error:[/bold red] {e}")
        raise click.Abort() from e

    if exit_code != 0:
        raise SystemExit(exit_code)


@cli.command()
@click.argument("image", type=click.Path(exists=True, path_type=Path))
@click.option("--split-len", type=int, default=10, help="Desired split length")
def info(image: Path, split_len: int) -> None:
    """Display information about an image and suggested settings.

    Example:
        img2sketch info input.jpg
        img2sketch info input.jpg --split-len 15
    """
    try:
        image_loader = create_image_loader()
        with console.status("[bold yellow]Analyzing image...", spinner="dots"):
            source_image = image_loader.load(image)

        table = Table(title=f"Image Information: {image.name}", show_header=True)
        table.add_column("Property", style="cyan", no_wrap=True)
        table.add_column("Value", style="magenta")

        table.add_row(
            "Dimensions",
            f"{source_image.dimensions.width}x{source_image.dimensions.height}",
        )
        table.add_row("Aspect Ratio", f"{source_image.dimensions.aspect_ratio:.2f}:1")

        adjuster = DimensionAdjuster()
        target_dims = adjuster.adjust_to_multiple(source_image.dimensions, split_len)

        if target_dims != source_image.dimensions:
            table.add_row(
                "Adjusted Dimensions",
                f"{target_dims.width}x{target_dims.height}",
            )
            table.add_row(
                "Note",
                "[yellow]Dimensions will be adjusted for compatibility[/yellow]",
            )
        else:
            table.add_row(
                "Compatibility",
                f"[green]✓ Compatible with split length {split_len}[/green]",
            )

        common_divisors = adjuster.get_common_divisors(target_dims, target_dims)[:10]
        table.add_row("Recommended Split Lengths", ", ".join(map(str, common_divisors)))

        console.print(table)

    except click.Abort:
        raise
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        raise click.Abort() from e


def _print_banner() -> None:
    """Print the application banner."""
    console.print(
        Panel.fit(
            "[bold cyan]AI Image to Sketch Video Generator[/bold cyan]",
            border_style="cyan",
        )
    )


def _bundled_image(name: str) -> Path:
    """Return the path to an image bundled inside the package."""
    return Path(str(importlib_resources.files("ai_img2sketch.resources.images"))) / name


def _require_hand_files(hand_image: Path, hand_mask: Path) -> None:
    """Abort early if the hand image or mask is missing."""
    if not hand_image.exists():
        console.print(f"[red]Error: Hand image not found: {hand_image}[/red]")
        raise click.Abort()
    if not hand_mask.exists():
        console.print(f"[red]Error: Hand mask not found: {hand_mask}[/red]")
        raise click.Abort()


def _generate_single(
    image: Path,
    config: VideoConfig,
    output: Path | None,
    object_masks: Path | None,
    hand_image: Path,
    hand_mask: Path,
) -> None:
    """Generate a single video from one image file."""
    output_path = VideoPathResolver().resolve(image, output)

    image_loader = create_image_loader()
    with console.status("[bold yellow]Loading image...", spinner="dots"):
        source_image = image_loader.load(image)

    console.print(f"[green]✓[/green] Loaded image: [cyan]{image.name}[/cyan]")
    console.print(
        f"  Dimensions: [cyan]{source_image.dimensions.width}x{source_image.dimensions.height}[/cyan]"
    )
    if object_masks is not None:
        console.print(f"  Object masks: [cyan]{object_masks.name}[/cyan]")
    console.print(f"  Output: [cyan]{output_path}[/cyan]")

    _display_config(config)
    console.print("\n[bold yellow]Generating sketch video...[/bold yellow]\n")

    use_case = build_generate_sketch_video_use_case(
        hand_image_path=hand_image,
        hand_mask_path=hand_mask,
    )
    produced_path = use_case.execute(
        source_image, config, output_path=output_path, object_mask_path=object_masks
    )

    console.print(
        Panel.fit(
            f"[bold green]✓ Video generated successfully![/bold green]\n\n"
            f"Output: [cyan]{produced_path}[/cyan]",
            border_style="green",
        )
    )


def _generate_directory(
    directory: Path,
    config: VideoConfig,
    output: Path | None,
    object_masks: Path | None,
    hand_image: Path,
    hand_mask: Path,
) -> int:
    """Generate one video per image found in a folder. Returns an exit code."""
    console.print(f"[green]✓[/green] Processing folder: [cyan]{directory}[/cyan]")

    _display_config(config)
    console.print("\n[bold yellow]Generating a video for every image...[/bold yellow]\n")

    use_case = build_generate_videos_from_directory_use_case(
        hand_image_path=hand_image,
        hand_mask_path=hand_mask,
    )
    summary = use_case.execute(
        directory, config, output_directory=output, object_mask_path=object_masks
    )
    _display_batch_summary(summary)
    return 0 if not summary.failed else 1


def _display_batch_summary(summary: BatchSummary) -> None:
    """Render the outcome of a batch run."""
    table = Table(title="Batch Results", show_header=True)
    table.add_column("Image", style="cyan", no_wrap=True)
    table.add_column("Status", no_wrap=True)
    table.add_column("Output")

    for item in summary.items:
        if item.succeeded:
            table.add_row(item.image_path.name, "[green]✓ done[/green]", str(item.output_path))
        else:
            table.add_row(item.image_path.name, "[red]✗ failed[/red]", f"[red]{item.error}[/red]")
    console.print(table)

    total = len(summary.items)
    succeeded = len(summary.succeeded)
    failed = len(summary.failed)
    if failed:
        console.print(
            f"\n[bold yellow]{succeeded}/{total} succeeded, {failed} failed.[/bold yellow]"
        )
    else:
        console.print(f"\n[bold green]✓ All {total} video(s) generated successfully![/bold green]")


def _display_config(config: VideoConfig) -> None:
    """Display configuration table."""
    table = Table(title="Video Configuration", show_header=True)
    table.add_column("Setting", style="cyan", no_wrap=True)
    table.add_column("Value", style="magenta")

    table.add_row("Frame Rate", f"{config.frame_rate} fps")
    table.add_row("Split Length", str(config.split_len))
    table.add_row("Object Skip Rate", str(config.object_skip_rate))
    table.add_row("End Duration", f"{config.end_duration_sec} seconds")

    console.print(table)


if __name__ == "__main__":
    cli()
