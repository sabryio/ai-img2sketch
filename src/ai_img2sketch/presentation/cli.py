"""CLI interface for AI Image to Sketch Video application."""

from pathlib import Path
from typing import cast

import click
import numpy as np
import numpy.typing as npt
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from ..application.use_cases.generate_sketch_video import GenerateSketchVideoUseCase
from ..domain.entities.image import Image
from ..domain.value_objects.video_config import VideoConfig
from ..infrastructure.image_processing.dimension_adjuster import DimensionAdjuster

console = Console()


def load_image(image_path: Path) -> Image:
    """Load image from file."""
    import cv2

    if not image_path.exists():
        raise FileNotFoundError(f"Image not found: {image_path}")

    img_data = cast(npt.NDArray[np.uint8] | None, cv2.imread(str(image_path)))
    if img_data is None:
        raise ValueError(f"Failed to load image: {image_path}")

    return Image.from_array(img_data, image_path)


@click.group()
@click.version_option(version="0.1.0")
def cli() -> None:
    """AI Image to Sketch Video - Convert images to animated sketch videos."""
    pass


@cli.command()
@click.argument("image", type=click.Path(exists=True, path_type=Path))
@click.option(
    "-o",
    "--output",
    type=click.Path(path_type=Path),
    default=None,
    help="Output directory for video (default: ./save_videos)",
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
    help="Drawing skip rate for objects (lower = more detailed)",
)
@click.option(
    "--bg-skip-rate",
    type=click.IntRange(1, 100),
    default=14,
    help="Drawing skip rate for background (can be higher)",
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
def generate(
    image: Path,
    output: Path | None,
    split_len: int,
    frame_rate: int,
    object_skip_rate: int,
    bg_skip_rate: int,
    end_duration: int,
    hand_image: Path | None,
    hand_mask: Path | None,
) -> None:
    """Generate sketch video from an image.

    Example:
        img2sketch generate input.jpg
        img2sketch generate input.jpg --split-len 15 --frame-rate 30
    """
    try:
        # Display header
        console.print(
            Panel.fit(
                "[bold cyan]AI Image to Sketch Video Generator[/bold cyan]",
                border_style="cyan",
            )
        )

        # Set default paths
        project_root = Path(__file__).parent.parent.parent.parent
        if output is None:
            output = project_root / "save_videos"

        if hand_image is None:
            hand_image = project_root / "images" / "drawing-hand.png"

        if hand_mask is None:
            hand_mask = project_root / "images" / "hand-mask.png"

        # Validate hand files
        if not hand_image.exists():
            console.print(f"[red]Error: Hand image not found: {hand_image}[/red]")
            raise click.Abort()

        if not hand_mask.exists():
            console.print(f"[red]Error: Hand mask not found: {hand_mask}[/red]")
            raise click.Abort()

        # Load image
        with console.status("[bold yellow]Loading image...", spinner="dots"):
            source_image = load_image(image)

        console.print(f"[green]✓[/green] Loaded image: [cyan]{image.name}[/cyan]")
        console.print(
            f"  Dimensions: [cyan]{source_image.dimensions.width}x{source_image.dimensions.height}[/cyan]"
        )

        # Create configuration
        config = VideoConfig(
            frame_rate=frame_rate,
            split_len=split_len,
            object_skip_rate=object_skip_rate,
            bg_object_skip_rate=bg_skip_rate,
            end_duration_sec=end_duration,
        )

        # Display configuration
        _display_config(config, split_len)

        # Adjust dimensions if needed
        adjuster = DimensionAdjuster()
        target_dims = adjuster.adjust_to_standard(source_image.dimensions, split_len)

        if target_dims != source_image.dimensions:
            console.print(
                f"[yellow]⚠[/yellow] Dimensions adjusted to: "
                f"[cyan]{target_dims.width}x{target_dims.height}[/cyan]"
            )

        # Generate video
        console.print("\n[bold yellow]Generating sketch video...[/bold yellow]\n")

        use_case = GenerateSketchVideoUseCase(
            hand_image_path=hand_image,
            hand_mask_path=hand_mask,
            output_directory=output,
        )

        output_path = use_case.execute(source_image, config)

        # Success message
        console.print(
            Panel.fit(
                f"[bold green]✓ Video generated successfully![/bold green]\n\n"
                f"Output: [cyan]{output_path}[/cyan]",
                border_style="green",
            )
        )

    except Exception as e:
        console.print(f"\n[bold red]Error:[/bold red] {str(e)}")
        raise click.Abort() from e


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
        # Load image
        with console.status("[bold yellow]Analyzing image...", spinner="dots"):
            source_image = load_image(image)

        # Create table
        table = Table(title=f"Image Information: {image.name}", show_header=True)
        table.add_column("Property", style="cyan", no_wrap=True)
        table.add_column("Value", style="magenta")

        # Add rows
        table.add_row(
            "Dimensions", f"{source_image.dimensions.width}x{source_image.dimensions.height}"
        )
        table.add_row("Aspect Ratio", f"{source_image.dimensions.aspect_ratio:.2f}:1")

        # Check dimension compatibility
        adjuster = DimensionAdjuster()
        target_dims = adjuster.adjust_to_standard(source_image.dimensions, split_len)

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

        # Get common divisors
        common_divisors = adjuster.get_common_divisors(target_dims, target_dims)[
            :10
        ]  # Show first 10
        table.add_row(
            "Recommended Split Lengths",
            ", ".join(map(str, common_divisors)),
        )

        console.print(table)

    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {str(e)}")
        raise click.Abort() from e


def _display_config(config: VideoConfig, split_len: int) -> None:
    """Display configuration table."""
    table = Table(title="Video Configuration", show_header=True)
    table.add_column("Setting", style="cyan", no_wrap=True)
    table.add_column("Value", style="magenta")

    table.add_row("Frame Rate", f"{config.frame_rate} fps")
    table.add_row("Split Length", str(split_len))
    table.add_row("Object Skip Rate", str(config.object_skip_rate))
    table.add_row("Background Skip Rate", str(config.bg_object_skip_rate))
    table.add_row("End Duration", f"{config.end_duration_sec} seconds")

    console.print(table)


if __name__ == "__main__":
    cli()
